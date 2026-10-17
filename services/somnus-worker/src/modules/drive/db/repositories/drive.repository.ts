import type { DriveMemberKeyInput, DriveNodeKeyInput, DriveRole } from "@somnus/api-contracts";
import { and, asc, count, eq, inArray, lt, ne } from "drizzle-orm";
import type { DriveDb } from "../drive-db.client.js";
import {
  driveAccounts,
  driveBlocks,
  driveMembers,
  driveNodes,
  driveShares,
  driveUploads,
} from "../schema/index.js";

export type AccountRow = typeof driveAccounts.$inferSelect;
export type ShareRow = typeof driveShares.$inferSelect;
export type MemberRow = typeof driveMembers.$inferSelect;
export type NodeRow = typeof driveNodes.$inferSelect;
export type UploadRow = typeof driveUploads.$inferSelect;

export type NewAccount = typeof driveAccounts.$inferInsert;
export type NewNode = typeof driveNodes.$inferInsert;
export type NewMember = typeof driveMembers.$inferInsert;
export type NewUpload = typeof driveUploads.$inferInsert;
export type NewBlock = typeof driveBlocks.$inferInsert;

export type AccountKeys = Pick<
  NewAccount,
  "email" | "encPublicKey" | "signPublicKey" | "privateKeys" | "passphraseWrap" | "recoveryWrap"
>;

export type NodePatch = Partial<
  Pick<
    NewNode,
    | "parentId"
    | "meta"
    | "signature"
    | "signedBy"
    | "trashedAt"
    | "trashedBy"
    | "nodeKey"
    | "keyGeneration"
  >
>;

/**
 * The persistence surface DriveService depends on -- an interface, as in the
 * Audit module, so the service's rules are tested against a fake and the
 * repository against real MySQL.
 */
export interface DriveStore {
  findAccount(userId: string): Promise<AccountRow | null>;
  findAccounts(userIds: ReadonlyArray<string>): Promise<AccountRow[]>;
  listAccounts(): Promise<AccountRow[]>;
  insertAccount(row: NewAccount): Promise<void>;
  updateAccount(
    userId: string,
    patch: Partial<Pick<NewAccount, "passphraseWrap" | "recoveryWrap" | "state">>,
  ): Promise<void>;
  /** Lost keys: memberships go, empty folders go, ownerless folders get an owner, keys are replaced. */
  resetAccount(userId: string, keys: AccountKeys): Promise<{ removedShares: number }>;
  /** Account deletion: the same departure from every folder, then the account row itself. */
  eraseAccount(userId: string): Promise<{ removedShares: number }>;

  findShare(shareId: string): Promise<ShareRow | null>;
  createShare(input: { share: ShareRow; root: NewNode; owner: NewMember }): Promise<void>;
  purgeShare(shareId: string): Promise<number>;
  listMembershipsFor(userId: string): Promise<MemberRow[]>;
  countMembers(shareIds: ReadonlyArray<string>): Promise<Map<string, number>>;
  findMember(shareId: string, userId: string): Promise<MemberRow | null>;
  listMembers(shareId: string): Promise<MemberRow[]>;
  insertMember(row: NewMember): Promise<void>;
  updateMemberRole(shareId: string, userId: string, role: DriveRole): Promise<void>;
  /** The member's own re-signed copy, for the generation it was checked against. */
  replaceOwnMemberKey(input: {
    shareId: string;
    userId: string;
    keyGeneration: number;
    memberKey: DriveMemberKeyInput;
  }): Promise<boolean>;
  rotate(input: {
    shareId: string;
    keyGeneration: number;
    removeUserId: string;
    grantedBy: string;
    memberKeys: ReadonlyArray<{
      userId: string;
      memberKey: DriveMemberKeyInput;
      memberKeyVersion: number;
    }>;
    nodeKeys: ReadonlyArray<{ nodeId: string; nodeKey: DriveNodeKeyInput }>;
  }): Promise<void>;

  findNode(nodeId: string): Promise<NodeRow | null>;
  findNodes(nodeIds: ReadonlyArray<string>): Promise<NodeRow[]>;
  listNodes(shareId: string): Promise<NodeRow[]>;
  insertNode(row: NewNode): Promise<void>;
  updateNode(nodeId: string, patch: NodePatch): Promise<void>;
  purgeNodes(nodeIds: ReadonlyArray<string>): Promise<void>;

  findUpload(nodeId: string, revision: number): Promise<UploadRow | null>;
  /** Replaces an unfinished upload of the same revision, if there was one. */
  startUpload(input: { upload: NewUpload; newNode?: NewNode }): Promise<void>;
  putBlock(row: NewBlock): Promise<void>;
  listBlockSizes(
    nodeId: string,
    revision: number,
  ): Promise<Array<{ blockIndex: number; sizeBytes: number }>>;
  commitUpload(nodeId: string, revision: number, at: Date): Promise<void>;
  findBlock(nodeId: string, revision: number, blockIndex: number): Promise<Buffer | null>;
  /** Abandoned uploads, and the never-committed files they created. */
  cleanupStaleUploads(shareId: string, olderThan: Date): Promise<void>;
}

export class DriveRepository implements DriveStore {
  constructor(private readonly db: DriveDb) {}

  // --- accounts ---

  async findAccount(userId: string): Promise<AccountRow | null> {
    const rows = await this.db
      .select()
      .from(driveAccounts)
      .where(eq(driveAccounts.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAccounts(userIds: ReadonlyArray<string>): Promise<AccountRow[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select()
      .from(driveAccounts)
      .where(inArray(driveAccounts.userId, [...userIds]));
  }

  async listAccounts(): Promise<AccountRow[]> {
    return this.db.select().from(driveAccounts).orderBy(asc(driveAccounts.email));
  }

  async insertAccount(row: NewAccount): Promise<void> {
    await this.db.insert(driveAccounts).values(row);
  }

  async updateAccount(
    userId: string,
    patch: Partial<Pick<NewAccount, "passphraseWrap" | "recoveryWrap" | "state">>,
  ): Promise<void> {
    await this.db
      .update(driveAccounts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(driveAccounts.userId, userId));
  }

  async resetAccount(userId: string, keys: AccountKeys): Promise<{ removedShares: number }> {
    return this.db.transaction(async (tx) => {
      const removedShares = await leaveAllSharesIn(tx, userId);

      const [current] = await tx
        .select({ keyVersion: driveAccounts.keyVersion })
        .from(driveAccounts)
        .where(eq(driveAccounts.userId, userId));
      await tx
        .update(driveAccounts)
        .set({
          ...keys,
          state: null,
          keyVersion: (current?.keyVersion ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(driveAccounts.userId, userId));
      return { removedShares };
    });
  }

  async eraseAccount(userId: string): Promise<{ removedShares: number }> {
    return this.db.transaction(async (tx) => {
      const removedShares = await leaveAllSharesIn(tx, userId);
      await tx.delete(driveAccounts).where(eq(driveAccounts.userId, userId));
      return { removedShares };
    });
  }

  // --- shares and members ---

  async findShare(shareId: string): Promise<ShareRow | null> {
    const rows = await this.db
      .select()
      .from(driveShares)
      .where(eq(driveShares.id, shareId))
      .limit(1);
    return rows[0] ?? null;
  }

  async createShare(input: { share: ShareRow; root: NewNode; owner: NewMember }): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(driveShares).values(input.share);
      await tx.insert(driveNodes).values(input.root);
      await tx.insert(driveMembers).values(input.owner);
    });
  }

  async purgeShare(shareId: string): Promise<number> {
    return this.db.transaction(async (tx) => purgeShareIn(tx, shareId));
  }

  async listMembershipsFor(userId: string): Promise<MemberRow[]> {
    return this.db.select().from(driveMembers).where(eq(driveMembers.userId, userId));
  }

  async countMembers(shareIds: ReadonlyArray<string>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (shareIds.length === 0) return result;
    const rows = await this.db
      .select({ shareId: driveMembers.shareId, total: count() })
      .from(driveMembers)
      .where(inArray(driveMembers.shareId, [...shareIds]))
      .groupBy(driveMembers.shareId);
    for (const row of rows) result.set(row.shareId, row.total);
    return result;
  }

  async findMember(shareId: string, userId: string): Promise<MemberRow | null> {
    const rows = await this.db
      .select()
      .from(driveMembers)
      .where(and(eq(driveMembers.shareId, shareId), eq(driveMembers.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listMembers(shareId: string): Promise<MemberRow[]> {
    return this.db
      .select()
      .from(driveMembers)
      .where(eq(driveMembers.shareId, shareId))
      .orderBy(asc(driveMembers.createdAt));
  }

  async insertMember(row: NewMember): Promise<void> {
    await this.db.insert(driveMembers).values(row);
  }

  async updateMemberRole(shareId: string, userId: string, role: DriveRole): Promise<void> {
    await this.db
      .update(driveMembers)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(driveMembers.shareId, shareId), eq(driveMembers.userId, userId)));
  }

  async replaceOwnMemberKey(
    input: Parameters<DriveStore["replaceOwnMemberKey"]>[0],
  ): Promise<boolean> {
    // Conditional on the generation, so a copy re-signed against a key that was
    // rotated in the meantime cannot overwrite the newer one.
    const [result] = await this.db
      .update(driveMembers)
      .set({ memberKey: input.memberKey, keySignedBy: input.userId, updatedAt: new Date() })
      .where(
        and(
          eq(driveMembers.shareId, input.shareId),
          eq(driveMembers.userId, input.userId),
          eq(driveMembers.keyGeneration, input.keyGeneration),
        ),
      );
    return result.affectedRows === 1;
  }

  async rotate(input: Parameters<DriveStore["rotate"]>[0]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(driveShares)
        .set({ keyGeneration: input.keyGeneration })
        .where(eq(driveShares.id, input.shareId));
      await tx
        .delete(driveMembers)
        .where(
          and(eq(driveMembers.shareId, input.shareId), eq(driveMembers.userId, input.removeUserId)),
        );
      for (const member of input.memberKeys) {
        await tx
          .update(driveMembers)
          .set({
            memberKey: member.memberKey,
            keyGeneration: input.keyGeneration,
            memberKeyVersion: member.memberKeyVersion,
            keySignedBy: input.grantedBy,
            updatedAt: now,
          })
          .where(
            and(eq(driveMembers.shareId, input.shareId), eq(driveMembers.userId, member.userId)),
          );
      }
      for (const node of input.nodeKeys) {
        await tx
          .update(driveNodes)
          .set({ nodeKey: node.nodeKey, keyGeneration: input.keyGeneration })
          .where(and(eq(driveNodes.id, node.nodeId), eq(driveNodes.shareId, input.shareId)));
      }
      // Files still uploading carry a key wrapped under the old folder key, and
      // nobody who stays can rewrap what they cannot see. They are dropped; the
      // uploader retries under the new key.
      const unfinished = await tx
        .select({ id: driveNodes.id })
        .from(driveNodes)
        .where(
          and(
            eq(driveNodes.shareId, input.shareId),
            eq(driveNodes.kind, "file"),
            eq(driveNodes.revision, 0),
          ),
        );
      await purgeNodesIn(
        tx,
        unfinished.map((n) => n.id),
      );
    });
  }

  // --- nodes ---

  async findNode(nodeId: string): Promise<NodeRow | null> {
    const rows = await this.db.select().from(driveNodes).where(eq(driveNodes.id, nodeId)).limit(1);
    return rows[0] ?? null;
  }

  async findNodes(nodeIds: ReadonlyArray<string>): Promise<NodeRow[]> {
    if (nodeIds.length === 0) return [];
    return this.db
      .select()
      .from(driveNodes)
      .where(inArray(driveNodes.id, [...nodeIds]));
  }

  async listNodes(shareId: string): Promise<NodeRow[]> {
    return this.db
      .select()
      .from(driveNodes)
      .where(eq(driveNodes.shareId, shareId))
      .orderBy(asc(driveNodes.createdAt));
  }

  async insertNode(row: NewNode): Promise<void> {
    await this.db.insert(driveNodes).values(row);
  }

  async updateNode(nodeId: string, patch: NodePatch): Promise<void> {
    await this.db
      .update(driveNodes)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(driveNodes.id, nodeId));
  }

  async purgeNodes(nodeIds: ReadonlyArray<string>): Promise<void> {
    await this.db.transaction(async (tx) => purgeNodesIn(tx, nodeIds));
  }

  // --- uploads and blocks ---

  async findUpload(nodeId: string, revision: number): Promise<UploadRow | null> {
    const rows = await this.db
      .select()
      .from(driveUploads)
      .where(and(eq(driveUploads.nodeId, nodeId), eq(driveUploads.revision, revision)))
      .limit(1);
    return rows[0] ?? null;
  }

  async startUpload(input: { upload: NewUpload; newNode?: NewNode }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { nodeId, revision } = input.upload;
      await tx
        .delete(driveBlocks)
        .where(and(eq(driveBlocks.nodeId, nodeId), eq(driveBlocks.revision, revision)));
      await tx
        .delete(driveUploads)
        .where(and(eq(driveUploads.nodeId, nodeId), eq(driveUploads.revision, revision)));
      if (input.newNode) await tx.insert(driveNodes).values(input.newNode);
      await tx.insert(driveUploads).values(input.upload);
    });
  }

  async putBlock(row: NewBlock): Promise<void> {
    await this.db
      .insert(driveBlocks)
      .values(row)
      .onDuplicateKeyUpdate({ set: { data: row.data, sizeBytes: row.sizeBytes } });
  }

  async listBlockSizes(
    nodeId: string,
    revision: number,
  ): Promise<Array<{ blockIndex: number; sizeBytes: number }>> {
    return this.db
      .select({ blockIndex: driveBlocks.blockIndex, sizeBytes: driveBlocks.sizeBytes })
      .from(driveBlocks)
      .where(and(eq(driveBlocks.nodeId, nodeId), eq(driveBlocks.revision, revision)));
  }

  async commitUpload(nodeId: string, revision: number, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [upload] = await tx
        .select()
        .from(driveUploads)
        .where(and(eq(driveUploads.nodeId, nodeId), eq(driveUploads.revision, revision)));
      if (!upload) return;
      await tx
        .update(driveNodes)
        .set({
          revision,
          blockCount: upload.blockCount,
          sizeBytes: upload.sizeBytes,
          contentHash: upload.contentHash,
          meta: upload.meta,
          signature: upload.signature,
          signedBy: upload.signedBy,
          updatedAt: at,
        })
        .where(eq(driveNodes.id, nodeId));
      // The previous revision's blocks go once the new one is live: the Drive
      // keeps the current version of a file, not its history.
      await tx
        .delete(driveBlocks)
        .where(and(eq(driveBlocks.nodeId, nodeId), ne(driveBlocks.revision, revision)));
      await tx.delete(driveUploads).where(eq(driveUploads.nodeId, nodeId));
    });
  }

  async findBlock(nodeId: string, revision: number, blockIndex: number): Promise<Buffer | null> {
    const rows = await this.db
      .select({ data: driveBlocks.data })
      .from(driveBlocks)
      .where(
        and(
          eq(driveBlocks.nodeId, nodeId),
          eq(driveBlocks.revision, revision),
          eq(driveBlocks.blockIndex, blockIndex),
        ),
      )
      .limit(1);
    return rows[0]?.data ?? null;
  }

  async cleanupStaleUploads(shareId: string, olderThan: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      const stale = await tx
        .select({ nodeId: driveUploads.nodeId, revision: driveUploads.revision })
        .from(driveUploads)
        .where(and(eq(driveUploads.shareId, shareId), lt(driveUploads.createdAt, olderThan)));
      for (const upload of stale) {
        await tx
          .delete(driveBlocks)
          .where(
            and(eq(driveBlocks.nodeId, upload.nodeId), eq(driveBlocks.revision, upload.revision)),
          );
        await tx
          .delete(driveUploads)
          .where(
            and(eq(driveUploads.nodeId, upload.nodeId), eq(driveUploads.revision, upload.revision)),
          );
      }
      const neverCommitted = await tx
        .select({ id: driveNodes.id })
        .from(driveNodes)
        .where(
          and(
            eq(driveNodes.shareId, shareId),
            eq(driveNodes.kind, "file"),
            eq(driveNodes.revision, 0),
            lt(driveNodes.createdAt, olderThan),
          ),
        );
      await purgeNodesIn(
        tx,
        neverCommitted.map((n) => n.id),
      );
    });
  }
}

type Tx = Parameters<Parameters<DriveDb["transaction"]>[0]>[0];

/**
 * Takes a person out of every folder they belong to. A folder nobody else holds
 * the key to is deleted (its content is unreadable by anyone from then on); a
 * folder left without an owner gets its longest-standing member as owner.
 * Returns how many folders were deleted.
 */
async function leaveAllSharesIn(tx: Tx, userId: string): Promise<number> {
  const memberships = await tx.select().from(driveMembers).where(eq(driveMembers.userId, userId));
  await tx.delete(driveMembers).where(eq(driveMembers.userId, userId));

  let removedShares = 0;
  for (const membership of memberships) {
    const remaining = await tx
      .select()
      .from(driveMembers)
      .where(eq(driveMembers.shareId, membership.shareId))
      .orderBy(asc(driveMembers.createdAt));
    if (remaining.length === 0) {
      await purgeShareIn(tx, membership.shareId);
      removedShares += 1;
      continue;
    }
    const longest = remaining[0];
    if (longest && !remaining.some((m) => m.role === "owner")) {
      await tx
        .update(driveMembers)
        .set({ role: "owner", updatedAt: new Date() })
        .where(
          and(
            eq(driveMembers.shareId, membership.shareId),
            eq(driveMembers.userId, longest.userId),
          ),
        );
    }
  }
  return removedShares;
}

async function purgeNodesIn(tx: Tx, nodeIds: ReadonlyArray<string>): Promise<void> {
  if (nodeIds.length === 0) return;
  const ids = [...nodeIds];
  await tx.delete(driveBlocks).where(inArray(driveBlocks.nodeId, ids));
  await tx.delete(driveUploads).where(inArray(driveUploads.nodeId, ids));
  await tx.delete(driveNodes).where(inArray(driveNodes.id, ids));
}

async function purgeShareIn(tx: Tx, shareId: string): Promise<number> {
  const [nodes] = await tx
    .select({ total: count() })
    .from(driveNodes)
    .where(eq(driveNodes.shareId, shareId));
  await tx.delete(driveBlocks).where(eq(driveBlocks.shareId, shareId));
  await tx.delete(driveUploads).where(eq(driveUploads.shareId, shareId));
  await tx.delete(driveNodes).where(eq(driveNodes.shareId, shareId));
  await tx.delete(driveMembers).where(eq(driveMembers.shareId, shareId));
  await tx.delete(driveShares).where(eq(driveShares.id, shareId));
  return nodes?.total ?? 0;
}
