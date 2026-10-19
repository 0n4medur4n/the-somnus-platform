import {
  DRIVE_BLOCK_SIZE,
  DRIVE_FILE_MAX_BYTES,
  type DriveAccount,
  type DriveDirectoryEntry,
  type DriveMember,
  type DriveNode,
  type DriveRole,
  type DriveShareSummary,
  opaqueId,
} from "@somnus/api-contracts";
import type { DriveEdge } from "../lib/edge.js";
import {
  type Bytes,
  concat,
  contentHash,
  DriveCryptoError,
  type DriveCryptoFailure,
  type DriveState,
  decryptBlock,
  encryptBlock,
  fingerprintOf,
  fromB64,
  importSymmetricKey,
  metaHash,
  type NodeMeta,
  newSymmetricKey,
  openMeta,
  openState,
  type SymmetricKey,
  sealMeta,
  sealState,
  signNode,
  type UnlockedAccount,
  unwrapNodeKey,
  unwrapShareKey,
  verifyNode,
  wrapNodeKey,
  wrapShareKeyFor,
} from "./crypto.js";

/**
 * How far a colleague's key is trusted, as the person sees it:
 * - `self`: it is me.
 * - `verified`: I compared fingerprints with them and marked it verified.
 * - `known`: the key I first saw for them, unchanged since.
 * - `changed`: their key is not the one I remember -- either they reset it, or
 *   someone is impersonating them. Never used to verify anything until I accept it.
 * - `unknown`: not in the Drive directory at all.
 */
export type Trust = "self" | "verified" | "known" | "changed" | "unknown";

export type Person = { userId: string; email: string | null; trust: Trust };

export type DriveItem = {
  node: DriveNode;
  /** Null when the item could not be opened; `problem` says why. */
  meta: NodeMeta | null;
  problem: DriveCryptoFailure | null;
  /** Whether the author's signature verified with a key I trust. */
  signature: "valid" | "unverified";
  author: Person;
};

export type DriveFolderView = {
  shareId: string;
  role: DriveRole;
  keyGeneration: number;
  name: string;
  rootId: string;
  /** Every node except the root, trashed ones included. */
  items: DriveItem[];
  members: Array<DriveMember & { trust: Trust }>;
};

export type DriveShareEntry = {
  shareId: string;
  role: DriveRole;
  memberCount: number;
  name: string | null;
  problem: DriveCryptoFailure | null;
};

/** A refusal the session raises itself, before anything is sent. */
export class DriveSessionError extends Error {
  constructor(
    readonly reason:
      | "file_too_large"
      | "key_changed"
      | "recipient_unknown"
      | "content_mismatch"
      | "not_open",
  ) {
    super(`drive session: ${reason}`);
    this.name = "DriveSessionError";
  }
}

function blocksOf(bytes: Uint8Array): Uint8Array[] {
  // An empty file is still one (empty) block: there is always something to
  // authenticate, so "no content" cannot be forged by deleting blocks.
  if (bytes.length === 0) return [new Uint8Array(0)];
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += DRIVE_BLOCK_SIZE) {
    blocks.push(bytes.subarray(offset, offset + DRIVE_BLOCK_SIZE));
  }
  return blocks;
}

/**
 * An open Drive. Holds, in memory only, the unlocked identity and the folder
 * and node keys it has opened; `close()` drops them all. Nothing here is ever
 * written to browser storage.
 */
export class DriveSession {
  private directory = new Map<string, DriveDirectoryEntry & { fingerprint: string }>();
  private shareKeys = new Map<string, { generation: number; key: SymmetricKey }>();
  private nodeKeys = new Map<string, SymmetricKey>();
  private stateDirty = false;

  private constructor(
    private readonly edge: DriveEdge,
    readonly me: UnlockedAccount,
    private state: DriveState,
  ) {}

  static async open(
    edge: DriveEdge,
    account: DriveAccount,
    me: UnlockedAccount,
  ): Promise<DriveSession> {
    const session = new DriveSession(edge, me, await openState(me, account.state));
    await session.refreshDirectory();
    return session;
  }

  close(): void {
    this.shareKeys.clear();
    this.nodeKeys.clear();
    this.directory.clear();
  }

  // --- people and their keys ---

  async refreshDirectory(): Promise<void> {
    const { entries } = await this.edge.directory();
    const next = new Map<string, DriveDirectoryEntry & { fingerprint: string }>();
    for (const entry of entries) {
      next.set(entry.userId, {
        ...entry,
        fingerprint: await fingerprintOf(entry.encPublicKey, entry.signPublicKey),
      });
    }
    this.directory = next;
  }

  /** Colleagues who set up the Drive, me excluded, with how far I trust each key. */
  colleagues(): Array<{ userId: string; email: string; fingerprint: string; trust: Trust }> {
    return [...this.directory.values()]
      .filter((entry) => entry.userId !== this.me.userId)
      .map((entry) => ({
        userId: entry.userId,
        email: entry.email,
        fingerprint: entry.fingerprint,
        trust: this.trustOf(entry.userId),
      }));
  }

  fingerprintOf(userId: string): string | null {
    return this.directory.get(userId)?.fingerprint ?? null;
  }

  trustOf(userId: string): Trust {
    if (userId === this.me.userId) {
      const own = this.directory.get(userId);
      // My own entry in the directory must be the key I am holding.
      return !own || own.fingerprint === this.me.fingerprint ? "self" : "changed";
    }
    const entry = this.directory.get(userId);
    if (!entry) return "unknown";
    const contact = this.state.contacts[userId];
    if (!contact) {
      // Trust on first use: remember this key, so a later swap is noticed.
      this.state.contacts[userId] = { fingerprint: entry.fingerprint, verified: false };
      this.stateDirty = true;
      return "known";
    }
    if (contact.fingerprint !== entry.fingerprint) return "changed";
    return contact.verified ? "verified" : "known";
  }

  person(userId: string): Person {
    return {
      userId,
      email: this.directory.get(userId)?.email ?? null,
      trust: this.trustOf(userId),
    };
  }

  /** The signing key I may verify with, or null if I must not trust the one on offer. */
  private trustedSignKey(userId: string): string | null {
    if (userId === this.me.userId) return this.me.signPublicKey;
    const trust = this.trustOf(userId);
    if (trust === "changed" || trust === "unknown") return null;
    return this.directory.get(userId)?.signPublicKey ?? null;
  }

  /** I compared fingerprints with this colleague and they match. */
  async markVerified(userId: string): Promise<void> {
    const entry = this.directory.get(userId);
    if (!entry) throw new DriveSessionError("recipient_unknown");
    this.state.contacts[userId] = { fingerprint: entry.fingerprint, verified: true };
    this.stateDirty = true;
    await this.flushState();
  }

  /** Accept a colleague's new key (after they reset theirs). Back to unverified. */
  async acceptNewKey(userId: string): Promise<void> {
    const entry = this.directory.get(userId);
    if (!entry) throw new DriveSessionError("recipient_unknown");
    this.state.contacts[userId] = { fingerprint: entry.fingerprint, verified: false };
    this.stateDirty = true;
    await this.flushState();
  }

  async flushState(): Promise<void> {
    if (!this.stateDirty) return;
    this.stateDirty = false;
    await this.edge.saveState({ state: await sealState(this.me, this.state) });
  }

  // --- shared folders ---

  async listShares(): Promise<DriveShareEntry[]> {
    const { shares } = await this.edge.shares();
    const entries = await Promise.all(shares.map((summary) => this.describeShare(summary)));
    await this.flushState();
    return entries;
  }

  private async describeShare(summary: DriveShareSummary): Promise<DriveShareEntry> {
    const base = {
      shareId: summary.shareId,
      role: summary.role,
      memberCount: summary.memberCount,
    };
    try {
      const shareKey = await this.shareKeyFor(summary);
      const rootKey = await this.nodeKey(shareKey, summary.root);
      const meta = await openMeta({
        nodeKey: rootKey,
        shareId: summary.shareId,
        nodeId: summary.root.id,
        revision: summary.root.revision,
        sealed: summary.root.meta,
      });
      return { ...base, name: meta.name, problem: null };
    } catch (error) {
      return { ...base, name: null, problem: failureOf(error) };
    }
  }

  /**
   * Opens my copy of a folder key, checking who signed it. The first time a
   * copy signed by someone else opens, I re-sign it as my own (see
   * `DriveMemberKeyAcceptRequestSchema`), so my access no longer depends on
   * their keys.
   */
  private async shareKeyFor(summary: DriveShareSummary): Promise<SymmetricKey> {
    const cached = this.shareKeys.get(summary.shareId);
    if (cached && cached.generation === summary.keyGeneration) return cached.key;

    const raw = await unwrapShareKey({
      me: this.me,
      shareId: summary.shareId,
      memberKey: summary.memberKey,
      signerPublicKey: this.trustedSignKey(summary.memberKey.signedBy),
    });
    const key = await importSymmetricKey(raw);
    this.shareKeys.set(summary.shareId, { generation: summary.keyGeneration, key });

    if (summary.memberKey.signedBy !== this.me.userId) {
      const own = await wrapShareKeyFor({
        me: this.me,
        shareId: summary.shareId,
        recipientUserId: this.me.userId,
        recipientEncPublicKey: this.me.encPublicKey,
        keyGeneration: summary.keyGeneration,
        shareKey: raw,
      });
      // Best effort: if it fails (a rotation raced it), the granter's copy still works.
      await this.edge
        .acceptKey(summary.shareId, { keyGeneration: summary.keyGeneration, memberKey: own })
        .catch(() => undefined);
    }
    return key;
  }

  private async nodeKey(shareKey: SymmetricKey, node: DriveNode): Promise<SymmetricKey> {
    const cached = this.nodeKeys.get(node.id);
    if (cached) return cached;
    const key = await unwrapNodeKey({
      shareKey,
      shareId: node.shareId,
      nodeId: node.id,
      keyGeneration: node.nodeKey.keyGeneration,
      wrapped: node.nodeKey,
    });
    this.nodeKeys.set(node.id, key);
    return key;
  }

  async createShare(name: string): Promise<void> {
    const shareId = opaqueId();
    const rootId = opaqueId();
    const shareKey = await newSymmetricKey();
    const root = await this.sealNewNode({
      shareKey,
      shareId,
      nodeId: rootId,
      keyGeneration: 1,
      kind: "folder",
      name,
    });
    const ownerKey = await wrapShareKeyFor({
      me: this.me,
      shareId,
      recipientUserId: this.me.userId,
      recipientEncPublicKey: this.me.encPublicKey,
      keyGeneration: 1,
      shareKey: shareKey.raw,
    });
    await this.edge.createShare({ shareId, root: { nodeId: rootId, ...root }, ownerKey });
  }

  async openShare(shareId: string): Promise<DriveFolderView> {
    const detail = await this.edge.share(shareId);
    const shareKey = await this.shareKeyFor(detail.share);
    const rootNode = detail.share.root;
    const items = await Promise.all(
      detail.nodes.filter((n) => n.id !== rootNode.id).map((n) => this.describeNode(shareKey, n)),
    );
    const root = await this.describeNode(shareKey, rootNode);
    const view: DriveFolderView = {
      shareId,
      role: detail.share.role,
      keyGeneration: detail.share.keyGeneration,
      name: root.meta?.name ?? "",
      rootId: rootNode.id,
      items,
      members: detail.members.map((m) => ({ ...m, trust: this.trustOf(m.userId) })),
    };
    await this.flushState();
    return view;
  }

  private async describeNode(shareKey: SymmetricKey, node: DriveNode): Promise<DriveItem> {
    const author = this.person(node.signedBy);
    try {
      const nodeKey = await this.nodeKey(shareKey, node);
      const meta = await openMeta({
        nodeKey,
        shareId: node.shareId,
        nodeId: node.id,
        revision: node.revision,
        sealed: node.meta,
      });
      const signKey = this.trustedSignKey(node.signedBy);
      const valid =
        signKey !== null &&
        (await verifyNode(
          signKey,
          {
            shareId: node.shareId,
            nodeId: node.id,
            kind: node.kind,
            revision: node.revision,
            metaHash: await metaHash(node.meta),
            contentHash: node.contentHash,
          },
          node.signature,
        ));
      return { node, meta, problem: null, signature: valid ? "valid" : "unverified", author };
    } catch (error) {
      return { node, meta: null, problem: failureOf(error), signature: "unverified", author };
    }
  }

  private requireShareKey(view: DriveFolderView): SymmetricKey {
    const cached = this.shareKeys.get(view.shareId);
    if (!cached || cached.generation !== view.keyGeneration) {
      throw new DriveSessionError("not_open");
    }
    return cached.key;
  }

  /** A new node's wrapped key, sealed name and signature. */
  private async sealNewNode(input: {
    shareKey: SymmetricKey;
    shareId: string;
    nodeId: string;
    keyGeneration: number;
    kind: "folder";
    name: string;
  }) {
    const nodeKey = await newSymmetricKey();
    this.nodeKeys.set(input.nodeId, nodeKey);
    const wrapped = await wrapNodeKey({
      shareKey: input.shareKey,
      shareId: input.shareId,
      nodeId: input.nodeId,
      keyGeneration: input.keyGeneration,
      nodeKey: nodeKey.raw,
    });
    const meta = await sealMeta({
      nodeKey,
      shareId: input.shareId,
      nodeId: input.nodeId,
      revision: 1,
      meta: { name: input.name, modifiedAt: new Date().toISOString() },
    });
    const signature = await signNode(this.me, {
      shareId: input.shareId,
      nodeId: input.nodeId,
      kind: input.kind,
      revision: 1,
      metaHash: await metaHash(meta),
      contentHash: "",
    });
    return { nodeKey: wrapped, meta, signature };
  }

  async createFolder(view: DriveFolderView, parentId: string, name: string): Promise<void> {
    const nodeId = opaqueId();
    const sealed = await this.sealNewNode({
      shareKey: this.requireShareKey(view),
      shareId: view.shareId,
      nodeId,
      keyGeneration: view.keyGeneration,
      kind: "folder",
      name,
    });
    await this.edge.createFolder(view.shareId, {
      nodeId,
      parentId,
      keyGeneration: view.keyGeneration,
      ...sealed,
    });
  }

  /**
   * Encrypts and uploads a file -- a new one under `parentId`, or a new revision
   * of `existing`. Every block is sealed here before the first byte is sent.
   * Answers the file's node id.
   */
  async writeFile(
    view: DriveFolderView,
    input: {
      parentId: string;
      existing?: DriveItem;
      name: string;
      mime: string;
      bytes: Uint8Array;
      note?: boolean;
      onProgress?: (done: number, total: number) => void;
    },
  ): Promise<string> {
    if (input.bytes.length > DRIVE_FILE_MAX_BYTES) throw new DriveSessionError("file_too_large");
    const shareKey = this.requireShareKey(view);
    const existing = input.existing;
    const nodeId = existing ? existing.node.id : opaqueId();
    const revision = existing ? existing.node.revision + 1 : 1;
    const nodeKey = existing
      ? await this.nodeKey(shareKey, existing.node)
      : await newSymmetricKey();
    if (!existing) this.nodeKeys.set(nodeId, nodeKey);

    const plain = blocksOf(input.bytes);
    const blocks: Bytes[] = [];
    for (const [index, plaintext] of plain.entries()) {
      blocks.push(
        await encryptBlock({ nodeKey, nodeId, revision, index, count: plain.length, plaintext }),
      );
    }
    const hash = await contentHash(blocks);
    const meta = await sealMeta({
      nodeKey,
      shareId: view.shareId,
      nodeId,
      revision,
      meta: {
        name: input.name,
        mime: input.mime,
        size: input.bytes.length,
        ...(input.note ? { note: true } : {}),
        modifiedAt: new Date().toISOString(),
      },
    });
    const signature = await signNode(this.me, {
      shareId: view.shareId,
      nodeId,
      kind: "file",
      revision,
      metaHash: await metaHash(meta),
      contentHash: hash,
    });

    await this.edge.startUpload(view.shareId, {
      nodeId,
      revision,
      ...(existing
        ? {}
        : {
            newFile: {
              parentId: input.parentId,
              keyGeneration: view.keyGeneration,
              nodeKey: await wrapNodeKey({
                shareKey,
                shareId: view.shareId,
                nodeId,
                keyGeneration: view.keyGeneration,
                nodeKey: nodeKey.raw,
              }),
            },
          }),
      blockCount: blocks.length,
      sizeBytes: blocks.reduce((n, b) => n + b.length, 0),
      contentHash: hash,
      meta,
      signature,
    });
    for (const [index, block] of blocks.entries()) {
      await this.edge.putBlock(view.shareId, nodeId, revision, index, block);
      input.onProgress?.(index + 1, blocks.length);
    }
    await this.edge.commit(view.shareId, nodeId, revision);
    return nodeId;
  }

  /** Downloads, checks and decrypts a file. Refuses anything that does not match what was signed. */
  async readFile(view: DriveFolderView, item: DriveItem): Promise<Bytes> {
    if (!item.meta) throw new DriveCryptoError(item.problem ?? "tampered");
    const node = item.node;
    const nodeKey = await this.nodeKey(this.requireShareKey(view), node);
    const blocks: Bytes[] = [];
    for (let index = 0; index < node.blockCount; index += 1) {
      const { data } = await this.edge.readBlock(view.shareId, node.id, node.revision, index);
      blocks.push(fromB64(data));
    }
    if ((await contentHash(blocks)) !== node.contentHash) {
      throw new DriveSessionError("content_mismatch");
    }
    const plain: Bytes[] = [];
    for (const [index, block] of blocks.entries()) {
      plain.push(
        await decryptBlock({
          nodeKey,
          nodeId: node.id,
          revision: node.revision,
          index,
          count: blocks.length,
          block,
        }),
      );
    }
    const bytes = concat(...plain);
    if (item.meta.size !== undefined && bytes.length !== item.meta.size) {
      throw new DriveSessionError("content_mismatch");
    }
    return bytes;
  }

  async rename(view: DriveFolderView, item: DriveItem, name: string): Promise<void> {
    if (!item.meta) throw new DriveCryptoError(item.problem ?? "tampered");
    const node = item.node;
    const nodeKey = await this.nodeKey(this.requireShareKey(view), node);
    const meta = await sealMeta({
      nodeKey,
      shareId: view.shareId,
      nodeId: node.id,
      revision: node.revision,
      meta: { ...item.meta, name },
    });
    const signature = await signNode(this.me, {
      shareId: view.shareId,
      nodeId: node.id,
      kind: node.kind,
      revision: node.revision,
      metaHash: await metaHash(meta),
      contentHash: node.contentHash,
    });
    await this.edge.rename(view.shareId, node.id, { meta, signature });
  }

  async renameShare(view: DriveFolderView, name: string): Promise<void> {
    const detail = await this.edge.share(view.shareId);
    const shareKey = this.requireShareKey(view);
    await this.rename(view, await this.describeNode(shareKey, detail.share.root), name);
  }

  move(view: DriveFolderView, item: DriveItem, parentId: string): Promise<unknown> {
    return this.edge.move(view.shareId, item.node.id, { parentId });
  }

  trash(view: DriveFolderView, item: DriveItem): Promise<unknown> {
    return this.edge.trash(view.shareId, item.node.id);
  }

  restore(view: DriveFolderView, item: DriveItem): Promise<unknown> {
    return this.edge.restore(view.shareId, item.node.id);
  }

  purge(view: DriveFolderView, item: DriveItem): Promise<unknown> {
    return this.edge.purgeNode(view.shareId, item.node.id);
  }

  async deleteShare(view: DriveFolderView): Promise<void> {
    await this.edge.purgeShare(view.shareId);
    this.shareKeys.delete(view.shareId);
  }

  // --- members ---

  /** Shares the folder with a colleague whose key I have not seen change. */
  async addMember(view: DriveFolderView, userId: string, role: DriveRole): Promise<void> {
    // A colleague who set up the Drive after I opened it is not in my copy yet.
    if (!this.directory.has(userId)) await this.refreshDirectory();
    const entry = this.directory.get(userId);
    if (!entry) throw new DriveSessionError("recipient_unknown");
    if (this.trustOf(userId) === "changed") throw new DriveSessionError("key_changed");
    const cached = this.shareKeys.get(view.shareId);
    if (!cached) throw new DriveSessionError("not_open");
    const memberKey = await wrapShareKeyFor({
      me: this.me,
      shareId: view.shareId,
      recipientUserId: userId,
      recipientEncPublicKey: entry.encPublicKey,
      keyGeneration: view.keyGeneration,
      shareKey: cached.key.raw,
    });
    await this.edge.addMember(view.shareId, {
      userId,
      role,
      keyGeneration: view.keyGeneration,
      memberKey,
    });
    await this.flushState();
  }

  setRole(view: DriveFolderView, userId: string, role: DriveRole): Promise<unknown> {
    return this.edge.setRole(view.shareId, userId, role);
  }

  /**
   * Removes a member -- or me, to leave -- and rotates the folder key in the
   * same request: a fresh key, wrapped for everyone who stays, and every node
   * key rewrapped under it. The removed person's old key opens nothing new.
   */
  async removeMember(view: DriveFolderView, userId: string): Promise<void> {
    const keyGeneration = view.keyGeneration + 1;
    const shareKey = await newSymmetricKey();
    const remaining = view.members.filter((m) => m.userId !== userId);

    const memberKeys = [];
    for (const member of remaining) {
      const entry = this.directory.get(member.userId);
      if (!entry) throw new DriveSessionError("recipient_unknown");
      if (this.trustOf(member.userId) === "changed") throw new DriveSessionError("key_changed");
      memberKeys.push({
        userId: member.userId,
        memberKey: await wrapShareKeyFor({
          me: this.me,
          shareId: view.shareId,
          recipientUserId: member.userId,
          recipientEncPublicKey: entry.encPublicKey,
          keyGeneration,
          shareKey: shareKey.raw,
        }),
      });
    }

    const oldShareKey = this.requireShareKey(view);
    const detail = await this.edge.share(view.shareId);
    const nodeKeys = [];
    for (const node of detail.nodes) {
      const nodeKey = await this.nodeKey(oldShareKey, node);
      nodeKeys.push({
        nodeId: node.id,
        nodeKey: await wrapNodeKey({
          shareKey,
          shareId: view.shareId,
          nodeId: node.id,
          keyGeneration,
          nodeKey: nodeKey.raw,
        }),
      });
    }

    await this.edge.removeMember(view.shareId, userId, { keyGeneration, memberKeys, nodeKeys });
    if (userId === this.me.userId) this.shareKeys.delete(view.shareId);
    else this.shareKeys.set(view.shareId, { generation: keyGeneration, key: shareKey });
  }
}

function failureOf(error: unknown): DriveCryptoFailure {
  return error instanceof DriveCryptoError ? error.failure : "tampered";
}
