import type {
  DriveMemberKeyInput,
  DriveMetaSealed,
  DriveNodeKeyInput,
  DriveNodeKind,
  DrivePassphraseWrap,
  DriveRecoveryWrap,
  DriveRole,
  DriveSealed,
  DriveStateSealed,
} from "@somnus/api-contracts";
import {
  deletePrefix,
  MUST_NOT_EXIST,
  type ObjectStore,
  PreconditionFailed,
} from "./object-store.js";

/**
 * The staff Drive's records, as objects in the bucket (ADR 0019):
 *
 *   accounts/{userId}.json                     one person's public keys + sealed private keys
 *   shares/{shareId}/manifest.json              a folder: key generation, members, nodes, uploads
 *   shares/{shareId}/blocks/{node}/{rev}/{i}    one encrypted block
 *   memberships/{userId}/{shareId}              an empty marker: "look in this folder"
 *
 * The manifest is the source of truth for a folder and is only ever replaced
 * with a compare-and-swap on its generation, so every change to a folder --
 * a rotation included -- is one atomic write. Markers are an index, never
 * trusted on their own: they are written before a member is added and removed
 * after a member leaves, so they can over-report but never under-report, and
 * every read confirms membership against the manifest.
 *
 * Every timestamp is an ISO string. Every sealed field is what a browser sent.
 */

export type AccountRecord = {
  userId: string;
  email: string;
  encPublicKey: string;
  signPublicKey: string;
  privateKeys: DriveSealed;
  passphraseWrap: DrivePassphraseWrap;
  recoveryWrap: DriveRecoveryWrap;
  state: DriveStateSealed | null;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type MemberRecord = {
  userId: string;
  /** The member's session email when they were added, for the people panel. */
  email: string;
  role: DriveRole;
  memberKey: DriveMemberKeyInput;
  keyGeneration: number;
  memberKeyVersion: number;
  /** Who granted access. Kept when the member re-signs their copy. */
  grantedBy: string;
  /** Whose signature `memberKey` carries: the granter's, then the member's own. */
  keySignedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type NodeRecord = {
  id: string;
  parentId: string | null;
  kind: DriveNodeKind;
  nodeKey: DriveNodeKeyInput;
  keyGeneration: number;
  meta: DriveMetaSealed;
  /** 0 while a new file is still uploading: never listed. */
  revision: number;
  blockCount: number;
  sizeBytes: number;
  contentHash: string;
  signature: string;
  signedBy: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
  trashedBy: string | null;
};

export type UploadRecord = {
  nodeId: string;
  revision: number;
  blockCount: number;
  sizeBytes: number;
  contentHash: string;
  meta: DriveMetaSealed;
  signature: string;
  signedBy: string;
  createdAt: string;
};

export type ShareManifest = {
  format: 1;
  id: string;
  keyGeneration: number;
  createdBy: string;
  createdAt: string;
  members: MemberRecord[];
  nodes: NodeRecord[];
  uploads: UploadRecord[];
};

/** How many times a contended manifest write is retried before giving up. */
const CAS_ATTEMPTS = 8;

const accountName = (userId: string) => `accounts/${userId}.json`;
const manifestName = (shareId: string) => `shares/${shareId}/manifest.json`;
const markerPrefix = (userId: string) => `memberships/${userId}/`;
const markerName = (userId: string, shareId: string) => `${markerPrefix(userId)}${shareId}`;
const blocksPrefix = (shareId: string, nodeId: string) => `shares/${shareId}/blocks/${nodeId}/`;
const blockName = (shareId: string, nodeId: string, revision: number, index: number) =>
  `${blocksPrefix(shareId, nodeId)}${revision}/${index}`;

function encode(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf-8");
}

function decode<T>(data: Buffer): T {
  return JSON.parse(data.toString("utf-8")) as T;
}

export class DriveStore {
  constructor(readonly objects: ObjectStore) {}

  get configured(): boolean {
    return this.objects.configured;
  }

  // --- accounts ---

  async getAccount(userId: string): Promise<AccountRecord | null> {
    const found = await this.objects.get(accountName(userId));
    return found ? decode<AccountRecord>(found.data) : null;
  }

  /** False if the person already has one: two concurrent enrollments cannot both win. */
  async createAccount(record: AccountRecord): Promise<boolean> {
    try {
      await this.objects.put(accountName(record.userId), encode(record), {
        ifGeneration: MUST_NOT_EXIST,
      });
      return true;
    } catch (error) {
      if (error instanceof PreconditionFailed) return false;
      throw error;
    }
  }

  async updateAccount(
    userId: string,
    mutate: (record: AccountRecord) => AccountRecord,
  ): Promise<AccountRecord | null> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const found = await this.objects.get(accountName(userId));
      if (!found) return null;
      const next = mutate(decode<AccountRecord>(found.data));
      try {
        await this.objects.put(accountName(userId), encode(next), {
          ifGeneration: found.generation,
        });
        return next;
      } catch (error) {
        if (!(error instanceof PreconditionFailed)) throw error;
      }
    }
    throw new PreconditionFailed(accountName(userId));
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.objects.delete(accountName(userId));
  }

  async listAccounts(): Promise<AccountRecord[]> {
    const listed = await this.objects.list("accounts/");
    const records = await Promise.all(listed.map((o) => this.objects.get(o.name)));
    return records
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => decode<AccountRecord>(r.data))
      .sort((a, b) => a.email.localeCompare(b.email));
  }

  // --- folders ---

  async getShare(shareId: string): Promise<ShareManifest | null> {
    const found = await this.objects.get(manifestName(shareId));
    return found ? decode<ShareManifest>(found.data) : null;
  }

  /** False if a folder with that id exists already. */
  async createShare(manifest: ShareManifest): Promise<boolean> {
    for (const member of manifest.members) await this.markMember(member.userId, manifest.id);
    try {
      await this.objects.put(manifestName(manifest.id), encode(manifest), {
        ifGeneration: MUST_NOT_EXIST,
      });
      return true;
    } catch (error) {
      if (error instanceof PreconditionFailed) return false;
      throw error;
    }
  }

  /**
   * Applies `mutate` to the current manifest and writes it back, but only if
   * nobody else wrote it in between; otherwise reads again and re-applies. Any
   * rule `mutate` enforces is therefore checked against the state it changes.
   * A refusal thrown by `mutate` aborts without writing.
   */
  async updateShare<T>(
    shareId: string,
    mutate: (manifest: ShareManifest) => { manifest: ShareManifest; result: T },
  ): Promise<{ manifest: ShareManifest; result: T } | null> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
      const found = await this.objects.get(manifestName(shareId));
      if (!found) return null;
      const outcome = mutate(decode<ShareManifest>(found.data));
      try {
        await this.objects.put(manifestName(shareId), encode(outcome.manifest), {
          ifGeneration: found.generation,
        });
        return outcome;
      } catch (error) {
        if (!(error instanceof PreconditionFailed)) throw error;
      }
    }
    throw new PreconditionFailed(manifestName(shareId));
  }

  /** The manifest first, so a half-deleted folder is unreachable rather than inconsistent. */
  async deleteShare(manifest: ShareManifest): Promise<void> {
    await this.objects.delete(manifestName(manifest.id));
    await deletePrefix(this.objects, `shares/${manifest.id}/`);
    await Promise.all(manifest.members.map((m) => this.unmarkMember(m.userId, manifest.id)));
  }

  // --- the membership index ---

  async shareIdsFor(userId: string): Promise<string[]> {
    const prefix = markerPrefix(userId);
    const listed = await this.objects.list(prefix);
    return listed.map((o) => o.name.slice(prefix.length));
  }

  async markMember(userId: string, shareId: string): Promise<void> {
    await this.objects.put(markerName(userId, shareId), Buffer.alloc(0));
  }

  async unmarkMember(userId: string, shareId: string): Promise<void> {
    await this.objects.delete(markerName(userId, shareId));
  }

  // --- blocks ---

  async putBlock(
    shareId: string,
    nodeId: string,
    revision: number,
    index: number,
    data: Buffer,
  ): Promise<void> {
    await this.objects.put(blockName(shareId, nodeId, revision, index), data);
  }

  async getBlock(
    shareId: string,
    nodeId: string,
    revision: number,
    index: number,
  ): Promise<Buffer | null> {
    const found = await this.objects.get(blockName(shareId, nodeId, revision, index));
    return found?.data ?? null;
  }

  async blockSizes(
    shareId: string,
    nodeId: string,
    revision: number,
  ): Promise<Array<{ blockIndex: number; sizeBytes: number }>> {
    const prefix = `${blocksPrefix(shareId, nodeId)}${revision}/`;
    const listed = await this.objects.list(prefix);
    return listed.map((o) => ({
      blockIndex: Number(o.name.slice(prefix.length)),
      sizeBytes: o.size,
    }));
  }

  /** Every block of a node, or every revision's but `keepRevision`'s. */
  async deleteBlocks(shareId: string, nodeId: string, keepRevision?: number): Promise<void> {
    const prefix = blocksPrefix(shareId, nodeId);
    const listed = await this.objects.list(prefix);
    await Promise.all(
      listed
        .filter(
          (o) => keepRevision === undefined || !o.name.startsWith(`${prefix}${keepRevision}/`),
        )
        .map((o) => this.objects.delete(o.name)),
    );
  }
}
