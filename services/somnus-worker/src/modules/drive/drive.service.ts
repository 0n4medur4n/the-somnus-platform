import {
  DRIVE_BLOCK_MAX_BYTES,
  DRIVE_MEMBERS_MAX,
  DRIVE_NODES_MAX,
  type DriveAccount,
  type DriveDirectory,
  type DriveEnrollRequest,
  type DriveEraseResult,
  type DriveFolderCreateRequest,
  type DriveKeyGenerationResult,
  type DriveMember,
  type DriveMemberAddRequest,
  type DriveMemberKeyAcceptRequest,
  type DriveMemberRemoveRequest,
  type DriveMoveRequest,
  type DriveNode,
  type DrivePurgeResult,
  type DriveRenameRequest,
  type DriveRewrapRequest,
  type DriveRole,
  type DriveShareCreateRequest,
  type DriveShareDetail,
  type DriveShareList,
  type DriveShareSummary,
  type DriveStateRequest,
  type DriveUploadStartRequest,
} from "@somnus/api-contracts";
import { ErrorCode } from "@somnus/errors";
import type { Clock } from "../../common/clock.js";
import {
  driveError,
  isCompleteRotation,
  isCompleteUpload,
  isValidMoveTarget,
  requireRole,
  subtreeIds,
  wouldLeaveNoOwner,
} from "./drive.policy.js";
import type {
  AccountRecord,
  DriveStore,
  MemberRecord,
  NodeRecord,
  ShareManifest,
} from "./storage/drive-store.js";

/** An abandoned upload is cleared after a day; nobody uploads one file for 24 hours. */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

type Mutation<T> = { manifest: ShareManifest; result: T };

/**
 * The Drive module's public interface (ADR 0019 / ADR 0010).
 *
 * Every method takes the acting person's opaque id, which edge-api resolved
 * from the session after identity granted `admin_drive`. This service never
 * sees a plaintext name, note or file, and never a key that opens one; it stores
 * sealed boxes and decides who may fetch or replace which of them.
 *
 * Every change to a folder goes through `DriveStore.updateShare`: the rule is
 * checked inside the compare-and-swap, against the manifest it is about to
 * replace, so two people acting at once cannot both pass a check that only one
 * of them should.
 */
export class DriveService {
  constructor(
    private readonly store: DriveStore,
    private readonly clock: Clock,
  ) {}

  private now(): string {
    return this.clock.now().toISOString();
  }

  // --- the caller's Drive identity ---

  async account(actorId: string): Promise<DriveAccount> {
    return toAccount(await this.requireAccount(actorId));
  }

  async enroll(actorId: string, email: string, body: DriveEnrollRequest): Promise<DriveAccount> {
    const now = this.now();
    const created = await this.store.createAccount({
      userId: actorId,
      email,
      ...body,
      state: null,
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (!created) throw driveError(ErrorCode.CONFLICT, "drive_account_exists");
    return this.account(actorId);
  }

  async rewrap(actorId: string, body: DriveRewrapRequest): Promise<DriveAccount> {
    const updated = await this.store.updateAccount(actorId, (r) => ({
      ...r,
      passphraseWrap: body.passphraseWrap,
      ...(body.recoveryWrap ? { recoveryWrap: body.recoveryWrap } : {}),
      updatedAt: this.now(),
    }));
    if (!updated) throw driveError(ErrorCode.NOT_FOUND, "drive_account_missing");
    return toAccount(updated);
  }

  async saveState(actorId: string, body: DriveStateRequest): Promise<DriveAccount> {
    const updated = await this.store.updateAccount(actorId, (r) => ({
      ...r,
      state: body.state,
      updatedAt: this.now(),
    }));
    if (!updated) throw driveError(ErrorCode.NOT_FOUND, "drive_account_missing");
    return toAccount(updated);
  }

  /**
   * New keys for someone who lost both their passphrase and their recovery code.
   * What only they could open is gone, by design: that is what end-to-end
   * encryption means. Colleagues can share the folders with them again.
   */
  async reset(actorId: string, email: string, body: DriveEnrollRequest): Promise<DriveAccount> {
    await this.requireAccount(actorId);
    await this.leaveEveryShare(actorId);
    const updated = await this.store.updateAccount(actorId, (r) => ({
      ...r,
      email,
      ...body,
      state: null,
      keyVersion: r.keyVersion + 1,
      updatedAt: this.now(),
    }));
    if (!updated) throw driveError(ErrorCode.NOT_FOUND, "drive_account_missing");
    return toAccount(updated);
  }

  /**
   * Right to erasure, called by edge-api's account deletion. Removes the person
   * from every folder (deleting the ones nobody else can open, never leaving one
   * ownerless) and deletes their account object -- email label and keys. What
   * they wrote stays in the folders they shared, as ciphertext only colleagues
   * can open, like any document a former colleague left in a shared drive.
   * Idempotent, and a no-op where the Drive was never configured.
   */
  async erase(actorId: string): Promise<DriveEraseResult> {
    if (!this.store.configured) return { erased: false, removedShares: 0 };
    const hadAccount = (await this.store.getAccount(actorId)) !== null;
    const removedShares = await this.leaveEveryShare(actorId);
    await this.store.deleteAccount(actorId);
    return { erased: hadAccount, removedShares };
  }

  async directory(actorId: string): Promise<DriveDirectory> {
    await this.requireAccount(actorId);
    const accounts = await this.store.listAccounts();
    return {
      entries: accounts.map((a) => ({
        userId: a.userId,
        email: a.email,
        encPublicKey: a.encPublicKey,
        signPublicKey: a.signPublicKey,
        keyVersion: a.keyVersion,
      })),
    };
  }

  /**
   * Takes a person out of every folder. A folder nobody else holds the key to
   * is deleted -- its content is unreadable by anyone from then on -- and a
   * folder left without an owner gets its longest-standing member as owner.
   */
  private async leaveEveryShare(userId: string): Promise<number> {
    let removed = 0;
    for (const shareId of await this.store.shareIdsFor(userId)) {
      const outcome = await this.store.updateShare(shareId, (m) => {
        const remaining = m.members.filter((x) => x.userId !== userId);
        const longest = [...remaining].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        const members =
          longest && !remaining.some((x) => x.role === "owner")
            ? remaining.map((x) =>
                x.userId === longest.userId ? { ...x, role: "owner" as const } : x,
              )
            : remaining;
        return { manifest: { ...m, members }, result: members.length === 0 };
      });
      if (outcome?.result) {
        await this.store.deleteShare(outcome.manifest);
        removed += 1;
      }
      await this.store.unmarkMember(userId, shareId);
    }
    return removed;
  }

  // --- shared folders ---

  async listShares(actorId: string): Promise<DriveShareList> {
    const manifests = await Promise.all(
      (await this.store.shareIdsFor(actorId)).map((id) => this.store.getShare(id)),
    );
    const shares: DriveShareSummary[] = [];
    for (const manifest of manifests) {
      // The membership index may over-report; the manifest decides.
      const member = manifest?.members.find((m) => m.userId === actorId);
      if (manifest && member) shares.push(toSummary(manifest, member));
    }
    return { shares };
  }

  async createShare(actorId: string, body: DriveShareCreateRequest): Promise<DriveShareSummary> {
    const account = await this.requireAccount(actorId);
    const now = this.now();
    const owner: MemberRecord = {
      userId: actorId,
      email: account.email,
      role: "owner",
      memberKey: body.ownerKey,
      keyGeneration: 1,
      memberKeyVersion: account.keyVersion,
      grantedBy: actorId,
      keySignedBy: actorId,
      createdAt: now,
      updatedAt: now,
    };
    const manifest: ShareManifest = {
      format: 1,
      id: body.shareId,
      keyGeneration: 1,
      createdBy: actorId,
      createdAt: now,
      members: [owner],
      nodes: [
        {
          id: body.root.nodeId,
          parentId: null,
          kind: "folder",
          nodeKey: body.root.nodeKey,
          keyGeneration: 1,
          meta: body.root.meta,
          revision: 1,
          blockCount: 0,
          sizeBytes: 0,
          contentHash: "",
          signature: body.root.signature,
          signedBy: actorId,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
          trashedBy: null,
        },
      ],
      uploads: [],
    };
    if (!(await this.store.createShare(manifest))) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    return toSummary(manifest, owner);
  }

  async shareDetail(actorId: string, shareId: string): Promise<DriveShareDetail> {
    const manifest = await this.readShare(shareId);
    const member = memberOf(manifest, actorId, "viewer");
    return {
      share: toSummary(manifest, member),
      nodes: manifest.nodes.filter(isCommitted).map((n) => toNode(manifest.id, n)),
      members: manifest.members.map(toMember),
    };
  }

  async purgeShare(actorId: string, shareId: string): Promise<DrivePurgeResult> {
    const manifest = await this.readShare(shareId);
    memberOf(manifest, actorId, "owner");
    await this.store.deleteShare(manifest);
    return { purged: manifest.nodes.length };
  }

  // --- members ---

  async addMember(
    actorId: string,
    shareId: string,
    body: DriveMemberAddRequest,
  ): Promise<DriveMember> {
    const recipient = await this.store.getAccount(body.userId);
    if (!recipient) throw driveError(ErrorCode.NOT_FOUND, "drive_recipient_unknown");
    // Validate before touching the index, so a refused add leaves nothing behind.
    memberOf(await this.readShare(shareId), actorId, "owner");
    // The index first: a marker without a membership is harmless, the reverse is not.
    await this.store.markMember(body.userId, shareId);
    const now = this.now();
    const added = await this.mutateShare(shareId, (m): Mutation<MemberRecord> => {
      memberOf(m, actorId, "owner");
      if (body.keyGeneration !== m.keyGeneration) {
        throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
      }
      if (m.members.some((x) => x.userId === body.userId)) {
        throw driveError(ErrorCode.CONFLICT, "drive_already_member");
      }
      if (m.members.length >= DRIVE_MEMBERS_MAX) {
        throw driveError(ErrorCode.CONFLICT, "drive_limit_reached");
      }
      const member: MemberRecord = {
        userId: body.userId,
        email: recipient.email,
        role: body.role,
        memberKey: body.memberKey,
        keyGeneration: m.keyGeneration,
        memberKeyVersion: recipient.keyVersion,
        grantedBy: actorId,
        keySignedBy: actorId,
        createdAt: now,
        updatedAt: now,
      };
      return { manifest: { ...m, members: [...m.members, member] }, result: member };
    });
    return toMember(added);
  }

  /**
   * Replaces the caller's own copy of the folder key with one they re-signed
   * themselves. Only their own entry, only at the current generation.
   */
  async acceptKey(
    actorId: string,
    shareId: string,
    body: DriveMemberKeyAcceptRequest,
  ): Promise<DriveShareSummary> {
    const now = this.now();
    return this.mutateShare(shareId, (m): Mutation<DriveShareSummary> => {
      const member = memberOf(m, actorId, "viewer");
      if (body.keyGeneration !== m.keyGeneration || member.keyGeneration !== m.keyGeneration) {
        throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
      }
      const replaced: MemberRecord = {
        ...member,
        memberKey: body.memberKey,
        keySignedBy: actorId,
        updatedAt: now,
      };
      const next = { ...m, members: m.members.map((x) => (x.userId === actorId ? replaced : x)) };
      return { manifest: next, result: toSummary(next, replaced) };
    });
  }

  async setRole(
    actorId: string,
    shareId: string,
    userId: string,
    role: DriveRole,
  ): Promise<DriveMember> {
    const now = this.now();
    return this.mutateShare(shareId, (m): Mutation<DriveMember> => {
      memberOf(m, actorId, "owner");
      const target = m.members.find((x) => x.userId === userId);
      if (!target) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
      if (target.role === "owner" && role !== "owner" && wouldLeaveNoOwner(m.members, userId)) {
        throw driveError(ErrorCode.CONFLICT, "drive_last_owner");
      }
      const updated = { ...target, role, updatedAt: now };
      return {
        manifest: { ...m, members: m.members.map((x) => (x.userId === userId ? updated : x)) },
        result: toMember(updated),
      };
    });
  }

  /**
   * Removes a member -- or lets a member leave -- and rotates the folder key in
   * the same write. The request must rewrap the new key for exactly the members
   * who stay and every node for exactly the folder's nodes.
   */
  async removeMember(
    actorId: string,
    shareId: string,
    userId: string,
    body: DriveMemberRemoveRequest,
  ): Promise<DriveKeyGenerationResult> {
    const versions = new Map(
      (await this.store.listAccounts()).map((a) => [a.userId, a.keyVersion] as const),
    );
    const now = this.now();
    const dropped = await this.mutateShare(shareId, (m): Mutation<string[]> => {
      // Anyone may leave; only an owner may remove somebody else.
      memberOf(m, actorId, actorId === userId ? "viewer" : "owner");
      const target = m.members.find((x) => x.userId === userId);
      if (!target) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
      const remaining = m.members.filter((x) => x.userId !== userId);
      // The last person in a folder does not leave it; they delete it.
      if (remaining.length === 0) throw driveError(ErrorCode.CONFLICT, "drive_last_owner");
      if (target.role === "owner" && wouldLeaveNoOwner(m.members, userId)) {
        throw driveError(ErrorCode.CONFLICT, "drive_last_owner");
      }
      if (body.keyGeneration !== m.keyGeneration + 1) {
        throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
      }
      const committed = m.nodes.filter(isCommitted);
      const complete = isCompleteRotation({
        remainingMemberIds: remaining.map((x) => x.userId),
        nodeIds: committed.map((n) => n.id),
        wrappedForMemberIds: body.memberKeys.map((x) => x.userId),
        rewrappedNodeIds: body.nodeKeys.map((n) => n.nodeId),
      });
      if (!complete) throw driveError(ErrorCode.CONFLICT, "drive_incomplete_rotation");

      const memberKeys = new Map(body.memberKeys.map((x) => [x.userId, x.memberKey]));
      const nodeKeys = new Map(body.nodeKeys.map((x) => [x.nodeId, x.nodeKey]));
      // Files still uploading carry a key wrapped under the old folder key, and
      // nobody who stays can rewrap what they cannot see: they are dropped, and
      // the uploader retries under the new key.
      const unfinished = m.nodes.filter((n) => !isCommitted(n)).map((n) => n.id);
      return {
        manifest: {
          ...m,
          keyGeneration: body.keyGeneration,
          members: remaining.map((x) => ({
            ...x,
            memberKey: memberKeys.get(x.userId) ?? x.memberKey,
            keyGeneration: body.keyGeneration,
            memberKeyVersion: versions.get(x.userId) ?? x.memberKeyVersion,
            keySignedBy: actorId,
            updatedAt: now,
          })),
          nodes: committed.map((n) => ({
            ...n,
            nodeKey: nodeKeys.get(n.id) ?? n.nodeKey,
            keyGeneration: body.keyGeneration,
          })),
          uploads: m.uploads.filter((u) => !unfinished.includes(u.nodeId)),
        },
        result: unfinished,
      };
    });
    await this.store.unmarkMember(userId, shareId);
    await Promise.all(dropped.map((nodeId) => this.store.deleteBlocks(shareId, nodeId)));
    return { keyGeneration: body.keyGeneration };
  }

  // --- folders and files ---

  async createFolder(
    actorId: string,
    shareId: string,
    body: DriveFolderCreateRequest,
  ): Promise<DriveNode> {
    const now = this.now();
    const node = await this.mutateShare(shareId, (m): Mutation<NodeRecord> => {
      memberOf(m, actorId, "editor");
      if (body.keyGeneration !== m.keyGeneration) {
        throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
      }
      requireLiveFolder(m, body.parentId);
      requireRoom(m);
      if (m.nodes.some((n) => n.id === body.nodeId)) {
        throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
      }
      const created: NodeRecord = {
        id: body.nodeId,
        parentId: body.parentId,
        kind: "folder",
        nodeKey: body.nodeKey,
        keyGeneration: m.keyGeneration,
        meta: body.meta,
        revision: 1,
        blockCount: 0,
        sizeBytes: 0,
        contentHash: "",
        signature: body.signature,
        signedBy: actorId,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
        trashedAt: null,
        trashedBy: null,
      };
      return { manifest: { ...m, nodes: [...m.nodes, created] }, result: created };
    });
    return toNode(shareId, node);
  }

  async startUpload(
    actorId: string,
    shareId: string,
    body: DriveUploadStartRequest,
  ): Promise<{ nodeId: string; revision: number }> {
    const now = this.now();
    const staleBefore = new Date(this.clock.now().getTime() - STALE_UPLOAD_MS).toISOString();
    const stale = await this.mutateShare(shareId, (base): Mutation<string[]> => {
      memberOf(base, actorId, "editor");
      // Abandoned uploads, and the never-committed files they created.
      const neverCommitted = base.nodes
        .filter((n) => !isCommitted(n) && n.createdAt < staleBefore)
        .map((n) => n.id);
      const m: ShareManifest = {
        ...base,
        uploads: base.uploads.filter(
          (u) =>
            u.createdAt >= staleBefore &&
            !neverCommitted.includes(u.nodeId) &&
            !(u.nodeId === body.nodeId && u.revision === body.revision),
        ),
        nodes: base.nodes.filter((n) => !neverCommitted.includes(n.id)),
      };
      const upload = {
        nodeId: body.nodeId,
        revision: body.revision,
        blockCount: body.blockCount,
        sizeBytes: body.sizeBytes,
        contentHash: body.contentHash,
        meta: body.meta,
        signature: body.signature,
        signedBy: actorId,
        createdAt: now,
      };
      const existing = m.nodes.find((n) => n.id === body.nodeId);

      if (body.newFile) {
        if (existing || body.revision !== 1) {
          throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
        }
        if (body.newFile.keyGeneration !== m.keyGeneration) {
          throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
        }
        requireLiveFolder(m, body.newFile.parentId);
        requireRoom(m);
        const created: NodeRecord = {
          id: body.nodeId,
          parentId: body.newFile.parentId,
          kind: "file",
          nodeKey: body.newFile.nodeKey,
          keyGeneration: m.keyGeneration,
          meta: body.meta,
          revision: 0,
          blockCount: 0,
          sizeBytes: 0,
          contentHash: "",
          signature: body.signature,
          signedBy: actorId,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
          trashedAt: null,
          trashedBy: null,
        };
        return {
          manifest: { ...m, nodes: [...m.nodes, created], uploads: [...m.uploads, upload] },
          result: neverCommitted,
        };
      }

      if (existing?.kind !== "file") {
        throw driveError(ErrorCode.NOT_FOUND, "drive_invalid_parent");
      }
      if (existing.trashedAt) throw driveError(ErrorCode.CONFLICT, "drive_invalid_parent");
      if (existing.revision === 0 || body.revision !== existing.revision + 1) {
        throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
      }
      return { manifest: { ...m, uploads: [...m.uploads, upload] }, result: neverCommitted };
    });
    await Promise.all(stale.map((nodeId) => this.store.deleteBlocks(shareId, nodeId)));
    return { nodeId: body.nodeId, revision: body.revision };
  }

  async putBlock(input: {
    actorId: string;
    shareId: string;
    nodeId: string;
    revision: number;
    blockIndex: number;
    data: Buffer;
  }): Promise<void> {
    const manifest = await this.readShare(input.shareId);
    memberOf(manifest, input.actorId, "editor");
    const upload = manifest.uploads.find(
      (u) => u.nodeId === input.nodeId && u.revision === input.revision,
    );
    if (!upload) throw driveError(ErrorCode.NOT_FOUND, "drive_upload_incomplete");
    if (input.blockIndex < 0 || input.blockIndex >= upload.blockCount) {
      throw driveError(ErrorCode.VALIDATION_FAILED, "drive_upload_incomplete");
    }
    if (input.data.length === 0 || input.data.length > DRIVE_BLOCK_MAX_BYTES) {
      throw driveError(ErrorCode.VALIDATION_FAILED, "drive_limit_reached");
    }
    await this.store.putBlock(
      input.shareId,
      input.nodeId,
      input.revision,
      input.blockIndex,
      input.data,
    );
  }

  async commit(
    actorId: string,
    shareId: string,
    nodeId: string,
    revision: number,
  ): Promise<DriveNode> {
    const blocks = await this.store.blockSizes(shareId, nodeId, revision);
    const now = this.now();
    const node = await this.mutateShare(shareId, (m): Mutation<NodeRecord> => {
      memberOf(m, actorId, "editor");
      const upload = m.uploads.find((u) => u.nodeId === nodeId && u.revision === revision);
      if (!upload) throw driveError(ErrorCode.NOT_FOUND, "drive_upload_incomplete");
      if (!isCompleteUpload(upload, blocks)) {
        throw driveError(ErrorCode.CONFLICT, "drive_upload_incomplete");
      }
      const current = requireNode(m, nodeId);
      if (revision !== current.revision + 1) {
        throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
      }
      const committed: NodeRecord = {
        ...current,
        revision,
        blockCount: upload.blockCount,
        sizeBytes: upload.sizeBytes,
        contentHash: upload.contentHash,
        meta: upload.meta,
        signature: upload.signature,
        signedBy: upload.signedBy,
        updatedAt: now,
      };
      return {
        manifest: {
          ...m,
          nodes: m.nodes.map((n) => (n.id === nodeId ? committed : n)),
          uploads: m.uploads.filter((u) => u.nodeId !== nodeId),
        },
        result: committed,
      };
    });
    // The previous revision's blocks go once the new one is live: the Drive
    // keeps the current version of a file, not its history.
    await this.store.deleteBlocks(shareId, nodeId, revision);
    return toNode(shareId, node);
  }

  async readBlock(input: {
    actorId: string;
    shareId: string;
    nodeId: string;
    revision: number;
    blockIndex: number;
  }): Promise<{ data: string }> {
    const manifest = await this.readShare(input.shareId);
    memberOf(manifest, input.actorId, "viewer");
    const node = requireNode(manifest, input.nodeId);
    if (node.revision !== input.revision) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    const data = await this.store.getBlock(
      input.shareId,
      input.nodeId,
      input.revision,
      input.blockIndex,
    );
    if (!data) throw driveError(ErrorCode.NOT_FOUND, "drive_upload_incomplete");
    return { data: data.toString("base64") };
  }

  async rename(
    actorId: string,
    shareId: string,
    nodeId: string,
    body: DriveRenameRequest,
  ): Promise<DriveNode> {
    return this.updateNode(shareId, actorId, nodeId, (_m, member, node) => {
      // Renaming the root renames the shared folder for everyone in it.
      if (node.parentId === null) requireRole(member.role, "owner");
      return { ...node, meta: body.meta, signature: body.signature, signedBy: actorId };
    });
  }

  async move(
    actorId: string,
    shareId: string,
    nodeId: string,
    body: DriveMoveRequest,
  ): Promise<DriveNode> {
    return this.updateNode(shareId, actorId, nodeId, (m, _member, node) => {
      if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
      requireLiveFolder(m, body.parentId);
      if (!isValidMoveTarget(m.nodes, nodeId, body.parentId)) {
        throw driveError(ErrorCode.CONFLICT, "drive_invalid_parent");
      }
      return { ...node, parentId: body.parentId };
    });
  }

  async trash(actorId: string, shareId: string, nodeId: string): Promise<DriveNode> {
    const at = this.now();
    return this.updateNode(shareId, actorId, nodeId, (_m, _member, node) => {
      if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
      return { ...node, trashedAt: at, trashedBy: actorId };
    });
  }

  async restore(actorId: string, shareId: string, nodeId: string): Promise<DriveNode> {
    return this.updateNode(shareId, actorId, nodeId, (_m, _member, node) => {
      if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
      return { ...node, trashedAt: null, trashedBy: null };
    });
  }

  /** Permanent. Only from the trash, and only by an owner. */
  async purgeNode(actorId: string, shareId: string, nodeId: string): Promise<DrivePurgeResult> {
    const ids = await this.mutateShare(shareId, (m): Mutation<string[]> => {
      memberOf(m, actorId, "owner");
      const node = requireNode(m, nodeId);
      if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
      if (!node.trashedAt) throw driveError(ErrorCode.CONFLICT, "drive_not_trashed");
      const subtree = subtreeIds(m.nodes, nodeId);
      return {
        manifest: {
          ...m,
          nodes: m.nodes.filter((n) => !subtree.includes(n.id)),
          uploads: m.uploads.filter((u) => !subtree.includes(u.nodeId)),
        },
        result: subtree,
      };
    });
    await Promise.all(ids.map((id) => this.store.deleteBlocks(shareId, id)));
    return { purged: ids.length };
  }

  // --- helpers ---

  private async requireAccount(actorId: string): Promise<AccountRecord> {
    const account = await this.store.getAccount(actorId);
    if (!account) throw driveError(ErrorCode.NOT_FOUND, "drive_account_missing");
    return account;
  }

  private async readShare(shareId: string): Promise<ShareManifest> {
    const manifest = await this.store.getShare(shareId);
    if (!manifest) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    return manifest;
  }

  private async mutateShare<T>(
    shareId: string,
    mutate: (m: ShareManifest) => Mutation<T>,
  ): Promise<T> {
    const outcome = await this.store.updateShare(shareId, mutate);
    if (!outcome) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    return outcome.result;
  }

  private async updateNode(
    shareId: string,
    actorId: string,
    nodeId: string,
    change: (m: ShareManifest, member: MemberRecord, node: NodeRecord) => NodeRecord,
  ): Promise<DriveNode> {
    const now = this.now();
    const updated = await this.mutateShare(shareId, (m): Mutation<NodeRecord> => {
      const member = memberOf(m, actorId, "editor");
      const next = { ...change(m, member, requireNode(m, nodeId)), updatedAt: now };
      return {
        manifest: { ...m, nodes: m.nodes.map((n) => (n.id === nodeId ? next : n)) },
        result: next,
      };
    });
    return toNode(shareId, updated);
  }
}

/** Membership first, then rank. A non-member is told only that the folder is not theirs. */
function memberOf(m: ShareManifest, userId: string, minimum: DriveRole): MemberRecord {
  const member = m.members.find((x) => x.userId === userId);
  requireRole(member?.role ?? null, minimum);
  return member as MemberRecord;
}

/** Scoped: a node id from another folder is "not found", never "found elsewhere". */
function requireNode(m: ShareManifest, nodeId: string): NodeRecord {
  const node = m.nodes.find((n) => n.id === nodeId);
  if (!node) throw driveError(ErrorCode.NOT_FOUND, "drive_invalid_parent");
  return node;
}

function requireLiveFolder(m: ShareManifest, folderId: string): void {
  const parent = m.nodes.find((n) => n.id === folderId);
  if (parent?.kind !== "folder" || parent.trashedAt) {
    throw driveError(ErrorCode.CONFLICT, "drive_invalid_parent");
  }
}

function requireRoom(m: ShareManifest): void {
  if (m.nodes.length >= DRIVE_NODES_MAX) {
    throw driveError(ErrorCode.CONFLICT, "drive_limit_reached");
  }
}

/** A file still uploading is nobody's business but its uploader's retry. */
function isCommitted(node: NodeRecord): boolean {
  return node.kind === "folder" || node.revision > 0;
}

function toAccount(row: AccountRecord): DriveAccount {
  return {
    userId: row.userId,
    email: row.email,
    encPublicKey: row.encPublicKey,
    signPublicKey: row.signPublicKey,
    privateKeys: row.privateKeys,
    passphraseWrap: row.passphraseWrap,
    recoveryWrap: row.recoveryWrap,
    state: row.state,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toNode(shareId: string, row: NodeRecord): DriveNode {
  return {
    id: row.id,
    shareId,
    parentId: row.parentId,
    kind: row.kind,
    nodeKey: { ...row.nodeKey, keyGeneration: row.keyGeneration },
    meta: row.meta,
    revision: row.revision,
    blockCount: row.blockCount,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    signature: row.signature,
    signedBy: row.signedBy,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    trashedAt: row.trashedAt,
  };
}

function toMember(row: MemberRecord): DriveMember {
  return {
    userId: row.userId,
    email: row.email,
    role: row.role,
    keyGeneration: row.keyGeneration,
    memberKeyVersion: row.memberKeyVersion,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
  };
}

function toSummary(m: ShareManifest, member: MemberRecord): DriveShareSummary {
  const root = m.nodes.find((n) => n.parentId === null) as NodeRecord;
  return {
    shareId: m.id,
    role: member.role,
    keyGeneration: m.keyGeneration,
    memberKey: {
      ...member.memberKey,
      keyGeneration: member.keyGeneration,
      signedBy: member.keySignedBy,
    },
    memberCount: m.members.length,
    root: toNode(m.id, root),
  };
}
