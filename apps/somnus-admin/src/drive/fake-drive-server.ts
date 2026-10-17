import type {
  DriveAccount,
  DriveMember,
  DriveMemberKeyInput,
  DriveNode,
  DriveRole,
  DriveShareSummary,
} from "@somnus/api-contracts";
import type { DriveEdge } from "../lib/edge.js";

/**
 * An in-memory stand-in for the Drive's server side, for the console's tests.
 *
 * It keeps the same shapes the worker returns and enforces membership, but its
 * real job is to be an honest-but-curious server: every request body it ever
 * receives is kept in `received`, so a test can search all of it for plaintext.
 * Tests may also reach into `nodes` and `blocks` to play a dishonest one.
 */
type Member = {
  role: DriveRole;
  memberKey: DriveMemberKeyInput;
  keyGeneration: number;
  signedBy: string;
  grantedBy: string;
};

export class FakeDriveServer {
  readonly received: string[] = [];
  readonly accounts = new Map<string, DriveAccount>();
  readonly shares = new Map<string, { keyGeneration: number; members: Map<string, Member> }>();
  readonly nodes = new Map<string, DriveNode>();
  readonly blocks = new Map<string, Uint8Array>();
  private pending = new Map<string, Omit<DriveNode, "createdAt" | "updatedAt" | "trashedAt">>();

  private log(value: unknown): void {
    if (value instanceof Uint8Array) {
      this.received.push(new TextDecoder("latin1").decode(value));
      return;
    }
    this.received.push(JSON.stringify(value));
  }

  private member(shareId: string, userId: string): Member {
    const member = this.shares.get(shareId)?.members.get(userId);
    if (!member) throw Object.assign(new Error("not a member"), { status: 404 });
    return member;
  }

  private summary(shareId: string, userId: string): DriveShareSummary {
    const share = this.shares.get(shareId);
    const member = this.member(shareId, userId);
    const root = [...this.nodes.values()].find((n) => n.shareId === shareId && !n.parentId);
    if (!share || !root) throw new Error("broken fake");
    return {
      shareId,
      role: member.role,
      keyGeneration: share.keyGeneration,
      memberKey: {
        ...member.memberKey,
        keyGeneration: member.keyGeneration,
        signedBy: member.signedBy,
      },
      memberCount: share.members.size,
      root,
    };
  }

  private now(): string {
    return new Date().toISOString();
  }

  /** The edge client as `userId` sees it. */
  edgeFor(userId: string, email: string): DriveEdge {
    const node = (id: string): DriveNode => {
      const n = this.nodes.get(id);
      if (!n) throw Object.assign(new Error("no node"), { status: 404 });
      return n;
    };
    const touch = (id: string, patch: Partial<DriveNode>): DriveNode => {
      const updated = { ...node(id), ...patch, updatedAt: this.now() };
      this.nodes.set(id, updated);
      return updated;
    };
    return {
      account: async () => {
        const account = this.accounts.get(userId);
        if (!account) throw Object.assign(new Error("missing"), { status: 404 });
        return account;
      },
      enroll: async (body) => {
        this.log(body);
        const account: DriveAccount = {
          userId,
          email,
          ...body,
          state: null,
          keyVersion: 1,
          createdAt: this.now(),
          updatedAt: this.now(),
        };
        this.accounts.set(userId, account);
        return account;
      },
      rewrap: async (body) => {
        this.log(body);
        const account: DriveAccount = {
          ...(this.accounts.get(userId) as DriveAccount),
          passphraseWrap: body.passphraseWrap,
          ...(body.recoveryWrap ? { recoveryWrap: body.recoveryWrap } : {}),
        };
        this.accounts.set(userId, account);
        return account;
      },
      saveState: async (body) => {
        this.log(body);
        const account = { ...(this.accounts.get(userId) as DriveAccount), state: body.state };
        this.accounts.set(userId, account);
        return account;
      },
      reset: async (body) => {
        this.log(body);
        const previous = this.accounts.get(userId) as DriveAccount;
        const account = { ...previous, ...body, state: null, keyVersion: previous.keyVersion + 1 };
        this.accounts.set(userId, account);
        for (const share of this.shares.values()) share.members.delete(userId);
        return account;
      },
      directory: async () => ({
        entries: [...this.accounts.values()].map((a) => ({
          userId: a.userId,
          email: a.email,
          encPublicKey: a.encPublicKey,
          signPublicKey: a.signPublicKey,
          keyVersion: a.keyVersion,
        })),
      }),
      shares: async () => ({
        shares: [...this.shares.entries()]
          .filter(([, share]) => share.members.has(userId))
          .map(([shareId]) => this.summary(shareId, userId)),
      }),
      createShare: async (body) => {
        this.log(body);
        this.shares.set(body.shareId, {
          keyGeneration: 1,
          members: new Map([
            [
              userId,
              {
                role: "owner",
                memberKey: body.ownerKey,
                keyGeneration: 1,
                signedBy: userId,
                grantedBy: userId,
              },
            ],
          ]),
        });
        this.nodes.set(body.root.nodeId, {
          id: body.root.nodeId,
          shareId: body.shareId,
          parentId: null,
          kind: "folder",
          nodeKey: { ...body.root.nodeKey, keyGeneration: 1 },
          meta: body.root.meta,
          revision: 1,
          blockCount: 0,
          sizeBytes: 0,
          contentHash: "",
          signature: body.root.signature,
          signedBy: userId,
          createdBy: userId,
          createdAt: this.now(),
          updatedAt: this.now(),
          trashedAt: null,
        });
        return this.summary(body.shareId, userId);
      },
      share: async (shareId) => {
        const summary = this.summary(shareId, userId);
        const share = this.shares.get(shareId);
        const members: DriveMember[] = [...(share?.members.entries() ?? [])].map(([id, m]) => ({
          userId: id,
          email: this.accounts.get(id)?.email ?? "",
          role: m.role,
          keyGeneration: m.keyGeneration,
          memberKeyVersion: this.accounts.get(id)?.keyVersion ?? 1,
          grantedBy: m.grantedBy,
          createdAt: this.now(),
        }));
        return {
          share: summary,
          nodes: [...this.nodes.values()].filter(
            (n) => n.shareId === shareId && (n.kind === "folder" || n.revision > 0),
          ),
          members,
        };
      },
      purgeShare: async (shareId) => {
        this.member(shareId, userId);
        this.shares.delete(shareId);
        let purged = 0;
        for (const [id, n] of this.nodes) {
          if (n.shareId === shareId) {
            this.nodes.delete(id);
            purged += 1;
          }
        }
        return { purged };
      },
      addMember: async (shareId, body) => {
        this.log(body);
        this.member(shareId, userId);
        const share = this.shares.get(shareId);
        share?.members.set(body.userId, {
          role: body.role,
          memberKey: body.memberKey,
          keyGeneration: body.keyGeneration,
          signedBy: userId,
          grantedBy: userId,
        });
        return {
          userId: body.userId,
          email: this.accounts.get(body.userId)?.email ?? "",
          role: body.role,
          keyGeneration: body.keyGeneration,
          memberKeyVersion: 1,
          grantedBy: userId,
          createdAt: this.now(),
        };
      },
      acceptKey: async (shareId, body) => {
        this.log(body);
        const member = this.member(shareId, userId);
        member.memberKey = body.memberKey;
        member.signedBy = userId;
        return this.summary(shareId, userId);
      },
      setRole: async (shareId, memberId, role) => {
        this.member(shareId, memberId).role = role;
        return {
          userId: memberId,
          email: "",
          role,
          keyGeneration: 1,
          memberKeyVersion: 1,
          grantedBy: userId,
          createdAt: this.now(),
        };
      },
      removeMember: async (shareId, memberId, body) => {
        this.log(body);
        const share = this.shares.get(shareId);
        if (!share) throw new Error("no share");
        share.members.delete(memberId);
        share.keyGeneration = body.keyGeneration;
        for (const { userId: id, memberKey } of body.memberKeys) {
          const m = share.members.get(id);
          if (m)
            Object.assign(m, { memberKey, keyGeneration: body.keyGeneration, signedBy: userId });
        }
        for (const { nodeId, nodeKey } of body.nodeKeys) {
          touch(nodeId, { nodeKey: { ...nodeKey, keyGeneration: body.keyGeneration } });
        }
        return { keyGeneration: body.keyGeneration };
      },
      createFolder: async (shareId, body) => {
        this.log(body);
        this.member(shareId, userId);
        const created: DriveNode = {
          id: body.nodeId,
          shareId,
          parentId: body.parentId,
          kind: "folder",
          nodeKey: { ...body.nodeKey, keyGeneration: body.keyGeneration },
          meta: body.meta,
          revision: 1,
          blockCount: 0,
          sizeBytes: 0,
          contentHash: "",
          signature: body.signature,
          signedBy: userId,
          createdBy: userId,
          createdAt: this.now(),
          updatedAt: this.now(),
          trashedAt: null,
        };
        this.nodes.set(body.nodeId, created);
        return created;
      },
      startUpload: async (shareId, body) => {
        this.log(body);
        this.member(shareId, userId);
        const existing = this.nodes.get(body.nodeId);
        if (!existing && body.newFile) {
          this.nodes.set(body.nodeId, {
            id: body.nodeId,
            shareId,
            parentId: body.newFile.parentId,
            kind: "file",
            nodeKey: { ...body.newFile.nodeKey, keyGeneration: body.newFile.keyGeneration },
            meta: body.meta,
            revision: 0,
            blockCount: 0,
            sizeBytes: 0,
            contentHash: "",
            signature: body.signature,
            signedBy: userId,
            createdBy: userId,
            createdAt: this.now(),
            updatedAt: this.now(),
            trashedAt: null,
          });
        }
        const base = this.nodes.get(body.nodeId) as DriveNode;
        this.pending.set(`${body.nodeId}:${body.revision}`, {
          ...base,
          revision: body.revision,
          blockCount: body.blockCount,
          sizeBytes: body.sizeBytes,
          contentHash: body.contentHash,
          meta: body.meta,
          signature: body.signature,
          signedBy: userId,
        });
        return { nodeId: body.nodeId, revision: body.revision };
      },
      putBlock: async (shareId, nodeId, revision, index, bytes) => {
        this.log(bytes);
        this.member(shareId, userId);
        this.blocks.set(`${nodeId}:${revision}:${index}`, bytes.slice());
      },
      commit: async (shareId, nodeId, revision) => {
        this.member(shareId, userId);
        const pending = this.pending.get(`${nodeId}:${revision}`);
        if (!pending) throw new Error("no upload");
        this.pending.delete(`${nodeId}:${revision}`);
        return touch(nodeId, pending);
      },
      readBlock: async (shareId, nodeId, revision, index) => {
        this.member(shareId, userId);
        const bytes = this.blocks.get(`${nodeId}:${revision}:${index}`);
        if (!bytes) throw Object.assign(new Error("no block"), { status: 404 });
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        return { data: btoa(binary) };
      },
      rename: async (shareId, nodeId, body) => {
        this.log(body);
        this.member(shareId, userId);
        return touch(nodeId, { meta: body.meta, signature: body.signature, signedBy: userId });
      },
      move: async (shareId, nodeId, body) => {
        this.member(shareId, userId);
        return touch(nodeId, { parentId: body.parentId });
      },
      trash: async (shareId, nodeId) => {
        this.member(shareId, userId);
        return touch(nodeId, { trashedAt: this.now() });
      },
      restore: async (shareId, nodeId) => {
        this.member(shareId, userId);
        return touch(nodeId, { trashedAt: null });
      },
      purgeNode: async (shareId, nodeId) => {
        this.member(shareId, userId);
        this.nodes.delete(nodeId);
        return { purged: 1 };
      },
    };
  }
}
