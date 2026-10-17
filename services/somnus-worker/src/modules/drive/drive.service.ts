import {
  DRIVE_BLOCK_MAX_BYTES,
  DRIVE_MEMBERS_MAX,
  DRIVE_NODES_MAX,
  type DriveAccount,
  type DriveDirectory,
  type DriveEnrollRequest,
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
import type {
  AccountRow,
  DriveStore,
  MemberRow,
  NodeRow,
  ShareRow,
} from "./db/repositories/index.js";
import {
  driveError,
  isCompleteRotation,
  isCompleteUpload,
  isValidMoveTarget,
  requireRole,
  subtreeIds,
  wouldLeaveNoOwner,
} from "./drive.policy.js";

/** An abandoned upload is cleared after a day; nobody uploads one file for 24 hours. */
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/**
 * The Drive module's public interface (ADR 0019 / ADR 0010).
 *
 * Every method takes the acting person's opaque id, which edge-api resolved
 * from the session after identity granted `admin_drive`. This service never
 * sees a plaintext name, note or file, and never a key that opens one; it stores
 * sealed boxes and decides who may fetch or replace which of them.
 */
export class DriveService {
  constructor(
    private readonly store: DriveStore,
    private readonly clock: Clock,
  ) {}

  // --- the caller's Drive identity ---

  async account(actorId: string): Promise<DriveAccount> {
    return toAccount(await this.requireAccount(actorId));
  }

  async enroll(actorId: string, email: string, body: DriveEnrollRequest): Promise<DriveAccount> {
    if (await this.store.findAccount(actorId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_account_exists");
    }
    const now = this.clock.now();
    await this.store.insertAccount({
      userId: actorId,
      email,
      ...body,
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    return this.account(actorId);
  }

  async rewrap(actorId: string, body: DriveRewrapRequest): Promise<DriveAccount> {
    await this.requireAccount(actorId);
    await this.store.updateAccount(actorId, {
      passphraseWrap: body.passphraseWrap,
      ...(body.recoveryWrap ? { recoveryWrap: body.recoveryWrap } : {}),
    });
    return this.account(actorId);
  }

  async saveState(actorId: string, body: DriveStateRequest): Promise<DriveAccount> {
    await this.requireAccount(actorId);
    await this.store.updateAccount(actorId, { state: body.state });
    return this.account(actorId);
  }

  /**
   * New keys for someone who lost both their passphrase and their recovery code.
   * What only they could open is gone, by design: that is what end-to-end
   * encryption means. Colleagues can share the folders with them again.
   */
  async reset(actorId: string, email: string, body: DriveEnrollRequest): Promise<DriveAccount> {
    await this.requireAccount(actorId);
    await this.store.resetAccount(actorId, { email, ...body });
    return this.account(actorId);
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

  // --- shared folders ---

  async listShares(actorId: string): Promise<DriveShareList> {
    const memberships = await this.store.listMembershipsFor(actorId);
    const shareIds = memberships.map((m) => m.shareId);
    const [counts, roots] = await Promise.all([
      this.store.countMembers(shareIds),
      Promise.all(shareIds.map((id) => this.loadShareAndRoot(id))),
    ]);
    const shares: DriveShareSummary[] = [];
    memberships.forEach((membership, i) => {
      const loaded = roots[i];
      if (!loaded) return;
      shares.push(
        toSummary(membership, loaded.share, loaded.root, counts.get(membership.shareId) ?? 1),
      );
    });
    return { shares };
  }

  async createShare(actorId: string, body: DriveShareCreateRequest): Promise<DriveShareSummary> {
    const account = await this.requireAccount(actorId);
    if (await this.store.findShare(body.shareId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    if (await this.store.findNode(body.root.nodeId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    const now = this.clock.now();
    const share: ShareRow = {
      id: body.shareId,
      keyGeneration: 1,
      createdBy: actorId,
      createdAt: now,
    };
    await this.store.createShare({
      share,
      root: {
        id: body.root.nodeId,
        shareId: body.shareId,
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
      },
      owner: {
        shareId: body.shareId,
        userId: actorId,
        role: "owner",
        memberKey: body.ownerKey,
        keyGeneration: 1,
        memberKeyVersion: account.keyVersion,
        grantedBy: actorId,
        keySignedBy: actorId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return (await this.shareDetail(actorId, body.shareId)).share;
  }

  async shareDetail(actorId: string, shareId: string): Promise<DriveShareDetail> {
    const membership = await this.membership(shareId, actorId, "viewer");
    const loaded = await this.loadShareAndRoot(shareId);
    if (!loaded) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    const [nodes, members] = await Promise.all([
      this.store.listNodes(shareId),
      this.store.listMembers(shareId),
    ]);
    const accounts = await this.store.findAccounts(members.map((m) => m.userId));
    const emails = new Map(accounts.map((a) => [a.userId, a.email]));
    return {
      share: toSummary(membership, loaded.share, loaded.root, members.length),
      nodes: nodes.filter(isCommitted).map(toNode),
      members: members.map((m) => toMember(m, emails.get(m.userId) ?? "")),
    };
  }

  async purgeShare(actorId: string, shareId: string): Promise<DrivePurgeResult> {
    await this.membership(shareId, actorId, "owner");
    return { purged: await this.store.purgeShare(shareId) };
  }

  // --- members ---

  async addMember(
    actorId: string,
    shareId: string,
    body: DriveMemberAddRequest,
  ): Promise<DriveMember> {
    await this.membership(shareId, actorId, "owner");
    const share = await this.requireShare(shareId);
    if (body.keyGeneration !== share.keyGeneration) {
      throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
    }
    const recipient = await this.store.findAccount(body.userId);
    if (!recipient) throw driveError(ErrorCode.NOT_FOUND, "drive_recipient_unknown");
    if (await this.store.findMember(shareId, body.userId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_already_member");
    }
    const members = await this.store.listMembers(shareId);
    if (members.length >= DRIVE_MEMBERS_MAX) {
      throw driveError(ErrorCode.CONFLICT, "drive_limit_reached");
    }
    const now = this.clock.now();
    await this.store.insertMember({
      shareId,
      userId: body.userId,
      role: body.role,
      memberKey: body.memberKey,
      keyGeneration: share.keyGeneration,
      memberKeyVersion: recipient.keyVersion,
      grantedBy: actorId,
      keySignedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    const added = await this.store.findMember(shareId, body.userId);
    if (!added) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    return toMember(added, recipient.email);
  }

  /**
   * Replaces the caller's own copy of the folder key with one they re-signed
   * themselves. Only their own row, only at the current generation.
   */
  async acceptKey(
    actorId: string,
    shareId: string,
    body: DriveMemberKeyAcceptRequest,
  ): Promise<DriveShareSummary> {
    await this.membership(shareId, actorId, "viewer");
    const share = await this.requireShare(shareId);
    if (body.keyGeneration !== share.keyGeneration) {
      throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
    }
    const replaced = await this.store.replaceOwnMemberKey({
      shareId,
      userId: actorId,
      keyGeneration: body.keyGeneration,
      memberKey: body.memberKey,
    });
    if (!replaced) throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
    return (await this.shareDetail(actorId, shareId)).share;
  }

  async setRole(
    actorId: string,
    shareId: string,
    userId: string,
    role: DriveRole,
  ): Promise<DriveMember> {
    await this.membership(shareId, actorId, "owner");
    const members = await this.store.listMembers(shareId);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    if (target.role === "owner" && role !== "owner" && wouldLeaveNoOwner(members, userId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_last_owner");
    }
    await this.store.updateMemberRole(shareId, userId, role);
    const account = await this.store.findAccount(userId);
    return toMember({ ...target, role }, account?.email ?? "");
  }

  /**
   * Removes a member -- or lets a member leave -- and rotates the folder key in
   * the same transaction. The request must rewrap the new key for exactly the
   * members who stay and every node for exactly the folder's nodes.
   */
  async removeMember(
    actorId: string,
    shareId: string,
    userId: string,
    body: DriveMemberRemoveRequest,
  ): Promise<DriveKeyGenerationResult> {
    // Anyone may leave; only an owner may remove somebody else.
    await this.membership(shareId, actorId, actorId === userId ? "viewer" : "owner");
    const share = await this.requireShare(shareId);
    const members = await this.store.listMembers(shareId);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    const remaining = members.filter((m) => m.userId !== userId);
    if (remaining.length === 0) {
      // The last person in a folder does not leave it; they delete it.
      throw driveError(ErrorCode.CONFLICT, "drive_last_owner");
    }
    if (target.role === "owner" && wouldLeaveNoOwner(members, userId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_last_owner");
    }
    if (body.keyGeneration !== share.keyGeneration + 1) {
      throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
    }
    const committed = (await this.store.listNodes(shareId)).filter(isCommitted);
    const complete = isCompleteRotation({
      remainingMemberIds: remaining.map((m) => m.userId),
      nodeIds: committed.map((n) => n.id),
      wrappedForMemberIds: body.memberKeys.map((m) => m.userId),
      rewrappedNodeIds: body.nodeKeys.map((n) => n.nodeId),
    });
    if (!complete) throw driveError(ErrorCode.CONFLICT, "drive_incomplete_rotation");

    const accounts = await this.store.findAccounts(remaining.map((m) => m.userId));
    const versions = new Map(accounts.map((a) => [a.userId, a.keyVersion]));
    await this.store.rotate({
      shareId,
      keyGeneration: body.keyGeneration,
      removeUserId: userId,
      grantedBy: actorId,
      memberKeys: body.memberKeys.map((m) => ({
        userId: m.userId,
        memberKey: m.memberKey,
        memberKeyVersion: versions.get(m.userId) ?? 1,
      })),
      nodeKeys: body.nodeKeys,
    });
    return { keyGeneration: body.keyGeneration };
  }

  // --- folders and files ---

  async createFolder(
    actorId: string,
    shareId: string,
    body: DriveFolderCreateRequest,
  ): Promise<DriveNode> {
    await this.membership(shareId, actorId, "editor");
    const share = await this.requireShare(shareId);
    if (body.keyGeneration !== share.keyGeneration) {
      throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
    }
    await this.requireLiveFolder(shareId, body.parentId);
    await this.requireRoom(shareId);
    if (await this.store.findNode(body.nodeId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    const now = this.clock.now();
    await this.store.insertNode({
      id: body.nodeId,
      shareId,
      parentId: body.parentId,
      kind: "folder",
      nodeKey: body.nodeKey,
      keyGeneration: share.keyGeneration,
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
    });
    return toNode(await this.requireNode(shareId, body.nodeId));
  }

  async startUpload(
    actorId: string,
    shareId: string,
    body: DriveUploadStartRequest,
  ): Promise<{ nodeId: string; revision: number }> {
    await this.membership(shareId, actorId, "editor");
    const share = await this.requireShare(shareId);
    const now = this.clock.now();
    await this.store.cleanupStaleUploads(shareId, new Date(now.getTime() - STALE_UPLOAD_MS));

    const upload = {
      nodeId: body.nodeId,
      revision: body.revision,
      shareId,
      blockCount: body.blockCount,
      sizeBytes: body.sizeBytes,
      contentHash: body.contentHash,
      meta: body.meta,
      signature: body.signature,
      signedBy: actorId,
      createdAt: now,
    };

    const existing = await this.store.findNode(body.nodeId);
    if (body.newFile) {
      if (existing) throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
      if (body.revision !== 1) throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
      if (body.newFile.keyGeneration !== share.keyGeneration) {
        throw driveError(ErrorCode.CONFLICT, "drive_stale_key_generation");
      }
      await this.requireLiveFolder(shareId, body.newFile.parentId);
      await this.requireRoom(shareId);
      await this.store.startUpload({
        upload,
        newNode: {
          id: body.nodeId,
          shareId,
          parentId: body.newFile.parentId,
          kind: "file",
          nodeKey: body.newFile.nodeKey,
          keyGeneration: share.keyGeneration,
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
        },
      });
      return { nodeId: body.nodeId, revision: body.revision };
    }

    if (!existing || existing.shareId !== shareId || existing.kind !== "file") {
      throw driveError(ErrorCode.NOT_FOUND, "drive_invalid_parent");
    }
    if (existing.trashedAt) throw driveError(ErrorCode.CONFLICT, "drive_invalid_parent");
    if (existing.revision === 0 || body.revision !== existing.revision + 1) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    await this.store.startUpload({ upload });
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
    await this.membership(input.shareId, input.actorId, "editor");
    const upload = await this.store.findUpload(input.nodeId, input.revision);
    if (!upload || upload.shareId !== input.shareId) {
      throw driveError(ErrorCode.NOT_FOUND, "drive_upload_incomplete");
    }
    if (input.blockIndex < 0 || input.blockIndex >= upload.blockCount) {
      throw driveError(ErrorCode.VALIDATION_FAILED, "drive_upload_incomplete");
    }
    if (input.data.length === 0 || input.data.length > DRIVE_BLOCK_MAX_BYTES) {
      throw driveError(ErrorCode.VALIDATION_FAILED, "drive_limit_reached");
    }
    await this.store.putBlock({
      nodeId: input.nodeId,
      revision: input.revision,
      blockIndex: input.blockIndex,
      shareId: input.shareId,
      sizeBytes: input.data.length,
      data: input.data,
    });
  }

  async commit(
    actorId: string,
    shareId: string,
    nodeId: string,
    revision: number,
  ): Promise<DriveNode> {
    await this.membership(shareId, actorId, "editor");
    const upload = await this.store.findUpload(nodeId, revision);
    if (!upload || upload.shareId !== shareId) {
      throw driveError(ErrorCode.NOT_FOUND, "drive_upload_incomplete");
    }
    const blocks = await this.store.listBlockSizes(nodeId, revision);
    if (!isCompleteUpload(upload, blocks)) {
      throw driveError(ErrorCode.CONFLICT, "drive_upload_incomplete");
    }
    const node = await this.requireNode(shareId, nodeId);
    if (revision !== node.revision + 1) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    await this.store.commitUpload(nodeId, revision, this.clock.now());
    return toNode(await this.requireNode(shareId, nodeId));
  }

  async readBlock(input: {
    actorId: string;
    shareId: string;
    nodeId: string;
    revision: number;
    blockIndex: number;
  }): Promise<{ data: string }> {
    await this.membership(input.shareId, input.actorId, "viewer");
    const node = await this.requireNode(input.shareId, input.nodeId);
    if (node.revision !== input.revision) {
      throw driveError(ErrorCode.CONFLICT, "drive_revision_conflict");
    }
    const data = await this.store.findBlock(input.nodeId, input.revision, input.blockIndex);
    if (!data) throw driveError(ErrorCode.NOT_FOUND, "drive_upload_incomplete");
    return { data: Buffer.from(data).toString("base64") };
  }

  async rename(
    actorId: string,
    shareId: string,
    nodeId: string,
    body: DriveRenameRequest,
  ): Promise<DriveNode> {
    const role = await this.membership(shareId, actorId, "editor");
    const node = await this.requireNode(shareId, nodeId);
    // Renaming the root renames the shared folder for everyone in it.
    if (node.parentId === null) requireRole(role.role, "owner");
    await this.store.updateNode(nodeId, {
      meta: body.meta,
      signature: body.signature,
      signedBy: actorId,
    });
    return toNode(await this.requireNode(shareId, nodeId));
  }

  async move(
    actorId: string,
    shareId: string,
    nodeId: string,
    body: DriveMoveRequest,
  ): Promise<DriveNode> {
    await this.membership(shareId, actorId, "editor");
    const node = await this.requireNode(shareId, nodeId);
    if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
    await this.requireLiveFolder(shareId, body.parentId);
    const nodes = await this.store.listNodes(shareId);
    if (!isValidMoveTarget(nodes, nodeId, body.parentId)) {
      throw driveError(ErrorCode.CONFLICT, "drive_invalid_parent");
    }
    await this.store.updateNode(nodeId, { parentId: body.parentId });
    return toNode(await this.requireNode(shareId, nodeId));
  }

  async trash(actorId: string, shareId: string, nodeId: string): Promise<DriveNode> {
    await this.membership(shareId, actorId, "editor");
    const node = await this.requireNode(shareId, nodeId);
    if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
    await this.store.updateNode(nodeId, { trashedAt: this.clock.now(), trashedBy: actorId });
    return toNode(await this.requireNode(shareId, nodeId));
  }

  async restore(actorId: string, shareId: string, nodeId: string): Promise<DriveNode> {
    await this.membership(shareId, actorId, "editor");
    const node = await this.requireNode(shareId, nodeId);
    if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
    await this.store.updateNode(nodeId, { trashedAt: null, trashedBy: null });
    return toNode(await this.requireNode(shareId, nodeId));
  }

  /** Permanent. Only from the trash, and only by an owner. */
  async purgeNode(actorId: string, shareId: string, nodeId: string): Promise<DrivePurgeResult> {
    await this.membership(shareId, actorId, "owner");
    const node = await this.requireNode(shareId, nodeId);
    if (node.parentId === null) throw driveError(ErrorCode.CONFLICT, "drive_root_node");
    if (!node.trashedAt) throw driveError(ErrorCode.CONFLICT, "drive_not_trashed");
    const ids = subtreeIds(await this.store.listNodes(shareId), nodeId);
    await this.store.purgeNodes(ids);
    return { purged: ids.length };
  }

  // --- helpers ---

  private async requireAccount(actorId: string): Promise<AccountRow> {
    const account = await this.store.findAccount(actorId);
    if (!account) throw driveError(ErrorCode.NOT_FOUND, "drive_account_missing");
    return account;
  }

  private async membership(
    shareId: string,
    actorId: string,
    minimum: DriveRole,
  ): Promise<MemberRow> {
    const member = await this.store.findMember(shareId, actorId);
    requireRole(member?.role ?? null, minimum);
    return member as MemberRow;
  }

  private async requireShare(shareId: string): Promise<ShareRow> {
    const share = await this.store.findShare(shareId);
    if (!share) throw driveError(ErrorCode.NOT_FOUND, "drive_not_a_member");
    return share;
  }

  /** Scoped: a node id from another folder is "not found", never "found elsewhere". */
  private async requireNode(shareId: string, nodeId: string): Promise<NodeRow> {
    const node = await this.store.findNode(nodeId);
    if (!node || node.shareId !== shareId) {
      throw driveError(ErrorCode.NOT_FOUND, "drive_invalid_parent");
    }
    return node;
  }

  private async requireLiveFolder(shareId: string, folderId: string): Promise<void> {
    const parent = await this.store.findNode(folderId);
    if (!parent || parent.shareId !== shareId || parent.kind !== "folder" || parent.trashedAt) {
      throw driveError(ErrorCode.CONFLICT, "drive_invalid_parent");
    }
  }

  private async requireRoom(shareId: string): Promise<void> {
    const nodes = await this.store.listNodes(shareId);
    if (nodes.length >= DRIVE_NODES_MAX) {
      throw driveError(ErrorCode.CONFLICT, "drive_limit_reached");
    }
  }

  private async loadShareAndRoot(
    shareId: string,
  ): Promise<{ share: ShareRow; root: NodeRow } | null> {
    const share = await this.store.findShare(shareId);
    if (!share) return null;
    const nodes = await this.store.listNodes(shareId);
    const root = nodes.find((n) => n.parentId === null);
    return root ? { share, root } : null;
  }
}

/** A file still uploading is nobody's business but its uploader's retry. */
function isCommitted(node: NodeRow): boolean {
  return node.kind === "folder" || node.revision > 0;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function toAccount(row: AccountRow): DriveAccount {
  return {
    userId: row.userId,
    email: row.email,
    encPublicKey: row.encPublicKey,
    signPublicKey: row.signPublicKey,
    privateKeys: row.privateKeys,
    passphraseWrap: row.passphraseWrap,
    recoveryWrap: row.recoveryWrap,
    state: row.state ?? null,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toNode(row: NodeRow): DriveNode {
  return {
    id: row.id,
    shareId: row.shareId,
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    trashedAt: iso(row.trashedAt),
  };
}

function toMember(row: MemberRow, email: string): DriveMember {
  return {
    userId: row.userId,
    email,
    role: row.role,
    keyGeneration: row.keyGeneration,
    memberKeyVersion: row.memberKeyVersion,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function toSummary(
  membership: MemberRow,
  share: ShareRow,
  root: NodeRow,
  memberCount: number,
): DriveShareSummary {
  return {
    shareId: share.id,
    role: membership.role,
    keyGeneration: share.keyGeneration,
    memberKey: {
      ...membership.memberKey,
      keyGeneration: membership.keyGeneration,
      signedBy: membership.keySignedBy,
    },
    memberCount,
    root: toNode(root),
  };
}
