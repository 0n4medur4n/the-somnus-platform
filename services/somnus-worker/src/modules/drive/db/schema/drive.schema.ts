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
  bigint,
  customType,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * The staff Drive's tables (ADR 0019). Every JSON column below holds sealed
 * material -- AES-GCM ciphertext and its IV, or a public key -- produced in a
 * browser. Nothing in this schema can be turned back into a name, a note or a
 * file without a key the server never receives.
 *
 * No foreign keys and no cascades (build plan §8: no triggers or database-side
 * behaviour to rely on); the repository deletes children explicitly, inside
 * the same transaction as the parent.
 */

/** MEDIUMBLOB: up to 16 MiB, comfortably above one 512 KiB block. */
const mediumBlob = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "mediumblob",
});

const ms = { fsp: 3 } as const;

/** One row per person who has set up the Drive: their public keys and their sealed private ones. */
export const driveAccounts = mysqlTable("drive_accounts", {
  userId: varchar("user_id", { length: 36 }).primaryKey(),
  /**
   * The session's email at enrollment, for the share dialog. Taken from the
   * server-side session by edge-api, never from the client, so nobody can
   * enroll under a colleague's name.
   */
  email: varchar("email", { length: 320 }).notNull(),
  encPublicKey: varchar("enc_public_key", { length: 256 }).notNull(),
  signPublicKey: varchar("sign_public_key", { length: 256 }).notNull(),
  privateKeys: json("private_keys").$type<DriveSealed>().notNull(),
  passphraseWrap: json("passphrase_wrap").$type<DrivePassphraseWrap>().notNull(),
  recoveryWrap: json("recovery_wrap").$type<DriveRecoveryWrap>().notNull(),
  /** Pinned key fingerprints, sealed under the account key. Null until first saved. */
  state: json("state").$type<DriveStateSealed>(),
  /** Bumped on every key reset, so a folder key wrapped for old keys is recognisable. */
  keyVersion: int("key_version").notNull().default(1),
  createdAt: timestamp("created_at", ms).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", ms).notNull().defaultNow(),
});

/** A shared folder: the unit of membership and of key rotation. */
export const driveShares = mysqlTable("drive_shares", {
  id: varchar("id", { length: 36 }).primaryKey(),
  keyGeneration: int("key_generation").notNull().default(1),
  createdBy: varchar("created_by", { length: 36 }).notNull(),
  createdAt: timestamp("created_at", ms).notNull().defaultNow(),
});

export const driveMembers = mysqlTable(
  "drive_members",
  {
    shareId: varchar("share_id", { length: 36 }).notNull(),
    userId: varchar("user_id", { length: 36 }).notNull(),
    role: varchar("role", { length: 16 }).$type<DriveRole>().notNull(),
    /** The folder key, wrapped for this member and signed by `grantedBy`. */
    memberKey: json("member_key").$type<DriveMemberKeyInput>().notNull(),
    keyGeneration: int("key_generation").notNull(),
    memberKeyVersion: int("member_key_version").notNull(),
    /** Who granted access. Kept when the member re-signs their copy. */
    grantedBy: varchar("granted_by", { length: 36 }).notNull(),
    /** Whose signature `member_key` carries: the granter's, then the member's own. */
    keySignedBy: varchar("key_signed_by", { length: 36 }).notNull(),
    createdAt: timestamp("created_at", ms).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", ms).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.shareId, t.userId] }),
    index("drive_members_user_idx").on(t.userId),
  ],
);

/** A folder or a file. A file with `revision = 0` is still uploading and is never listed. */
export const driveNodes = mysqlTable(
  "drive_nodes",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    shareId: varchar("share_id", { length: 36 }).notNull(),
    parentId: varchar("parent_id", { length: 36 }),
    kind: varchar("kind", { length: 16 }).$type<DriveNodeKind>().notNull(),
    nodeKey: json("node_key").$type<DriveNodeKeyInput>().notNull(),
    keyGeneration: int("key_generation").notNull(),
    meta: json("meta").$type<DriveMetaSealed>().notNull(),
    revision: int("revision").notNull().default(0),
    blockCount: int("block_count").notNull().default(0),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    contentHash: varchar("content_hash", { length: 64 }).notNull().default(""),
    signature: varchar("signature", { length: 128 }).notNull(),
    signedBy: varchar("signed_by", { length: 36 }).notNull(),
    createdBy: varchar("created_by", { length: 36 }).notNull(),
    createdAt: timestamp("created_at", ms).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", ms).notNull().defaultNow(),
    trashedAt: timestamp("trashed_at", ms),
    trashedBy: varchar("trashed_by", { length: 36 }),
  },
  (t) => [index("drive_nodes_share_idx").on(t.shareId)],
);

/** A file revision being uploaded. Committed into `drive_nodes`, then deleted. */
export const driveUploads = mysqlTable(
  "drive_uploads",
  {
    nodeId: varchar("node_id", { length: 36 }).notNull(),
    revision: int("revision").notNull(),
    shareId: varchar("share_id", { length: 36 }).notNull(),
    blockCount: int("block_count").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    meta: json("meta").$type<DriveMetaSealed>().notNull(),
    signature: varchar("signature", { length: 128 }).notNull(),
    signedBy: varchar("signed_by", { length: 36 }).notNull(),
    createdAt: timestamp("created_at", ms).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.revision] }),
    index("drive_uploads_share_idx").on(t.shareId),
  ],
);

/** One encrypted block: IV || AES-GCM ciphertext || tag. */
export const driveBlocks = mysqlTable(
  "drive_blocks",
  {
    nodeId: varchar("node_id", { length: 36 }).notNull(),
    revision: int("revision").notNull(),
    blockIndex: int("block_index").notNull(),
    shareId: varchar("share_id", { length: 36 }).notNull(),
    sizeBytes: int("size_bytes").notNull(),
    data: mediumBlob("data").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.revision, t.blockIndex] }),
    index("drive_blocks_share_idx").on(t.shareId),
  ],
);
