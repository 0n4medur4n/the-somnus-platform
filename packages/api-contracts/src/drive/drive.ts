import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

/**
 * The staff Drive (owner decision 2026-10-17, ADR 0019): an end-to-end
 * encrypted place in the admin console where internal staff share protocols,
 * rules, algorithms and usage instructions.
 *
 * **The server never holds a key that opens anything.** Every name, note and
 * file is encrypted in the browser before it is sent, so every field below that
 * carries content is ciphertext: base64 strings of bounded length and nothing
 * the server could read, index or validate beyond its size. What the server does
 * see -- the tree's shape, sizes, timestamps, who belongs to which folder -- is
 * listed in ADR 0019 as accepted metadata, the same set Proton Drive exposes.
 *
 * These schemas therefore bound sizes and shapes only. They make no claim about
 * cryptographic validity: the browser verifies signatures and the server, by
 * design, cannot.
 */

/** Plaintext bytes per file block. A block is the unit of upload and download. */
export const DRIVE_BLOCK_SIZE = 512 * 1024;
/** AES-GCM: a 12-byte IV prefixed to the ciphertext, and a 16-byte tag. */
export const DRIVE_BLOCK_OVERHEAD = 12 + 16;
/** The largest ciphertext block the edge and the worker accept. */
export const DRIVE_BLOCK_MAX_BYTES = DRIVE_BLOCK_SIZE + DRIVE_BLOCK_OVERHEAD;
/** 40 blocks of 512 KiB: a 20 MiB file. Protocols and notes, not video. */
export const DRIVE_MAX_BLOCKS = 40;
export const DRIVE_FILE_MAX_BYTES = DRIVE_BLOCK_SIZE * DRIVE_MAX_BLOCKS;
/** The encrypted metadata (name, type, size) of one node. */
export const DRIVE_META_MAX_BYTES = 4096;
/** The encrypted per-person state (pinned key fingerprints). */
export const DRIVE_STATE_MAX_BYTES = 64 * 1024;
/** PBKDF2-SHA256 work factor. The floor is enforced; a client may only raise it. */
export const DRIVE_PBKDF2_MIN_ITERATIONS = 600_000;
export const DRIVE_MEMBERS_MAX = 100;
export const DRIVE_NODES_MAX = 5000;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The number of bytes a base64 string decodes to, without decoding it. */
function decodedLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/** Base64 of between `min` and `max` bytes. Ciphertext, keys and signatures all travel this way. */
export function base64Bytes(min: number, max: number) {
  return z
    .string()
    .max(Math.ceil(max / 3) * 4)
    .regex(BASE64, "must be base64")
    .refine((value) => value.length % 4 === 0, "must be padded base64")
    .refine((value) => {
      const length = decodedLength(value);
      return length >= min && length <= max;
    }, `must decode to ${min}..${max} bytes`);
}

const Iv = base64Bytes(12, 12);
/** An SPKI-encoded P-256 public key (91 bytes; bounded loosely for encoders). */
const PublicKey = base64Bytes(64, 160);
/** A raw (IEEE P1363) ECDSA P-256 signature. */
const Signature = base64Bytes(64, 64);
/** A wrapped 256-bit key: 32 bytes of AES-GCM ciphertext plus the 16-byte tag. */
const WrappedKey = base64Bytes(48, 48);
/** SHA-256. */
const Digest = base64Bytes(32, 32);

/** AES-256-GCM output with its IV. */
export const DriveSealedSchema = z.object({ iv: Iv, ct: base64Bytes(17, 2048) }).strict();
export type DriveSealed = z.infer<typeof DriveSealedSchema>;

export const DriveMetaSealedSchema = z
  .object({ iv: Iv, ct: base64Bytes(17, DRIVE_META_MAX_BYTES) })
  .strict();
export type DriveMetaSealed = z.infer<typeof DriveMetaSealedSchema>;

export const DriveStateSealedSchema = z
  .object({ iv: Iv, ct: base64Bytes(17, DRIVE_STATE_MAX_BYTES) })
  .strict();
export type DriveStateSealed = z.infer<typeof DriveStateSealedSchema>;

/**
 * The account key, wrapped under a key derived from the person's Drive
 * passphrase. The passphrase itself never leaves the browser.
 */
export const DrivePassphraseWrapSchema = z
  .object({
    kdf: z.literal("PBKDF2-SHA256"),
    iterations: z.number().int().min(DRIVE_PBKDF2_MIN_ITERATIONS).max(10_000_000),
    salt: base64Bytes(16, 32),
    iv: Iv,
    ct: WrappedKey,
  })
  .strict();
export type DrivePassphraseWrap = z.infer<typeof DrivePassphraseWrapSchema>;

/**
 * The same account key, wrapped under the recovery code. The code is 160 random
 * bits, so a fast KDF is enough: there is nothing to brute-force.
 */
export const DriveRecoveryWrapSchema = z
  .object({ kdf: z.literal("HKDF-SHA256"), salt: base64Bytes(16, 32), iv: Iv, ct: WrappedKey })
  .strict();
export type DriveRecoveryWrap = z.infer<typeof DriveRecoveryWrapSchema>;

/** Everything a browser needs to create a Drive identity. All of it is public or sealed. */
export const DriveEnrollRequestSchema = z
  .object({
    encPublicKey: PublicKey,
    signPublicKey: PublicKey,
    privateKeys: DriveSealedSchema,
    passphraseWrap: DrivePassphraseWrapSchema,
    recoveryWrap: DriveRecoveryWrapSchema,
  })
  .strict();
export type DriveEnrollRequest = z.infer<typeof DriveEnrollRequestSchema>;

/** A changed passphrase; after a recovery, also a fresh recovery code. */
export const DriveRewrapRequestSchema = z
  .object({
    passphraseWrap: DrivePassphraseWrapSchema,
    recoveryWrap: DriveRecoveryWrapSchema.optional(),
  })
  .strict();
export type DriveRewrapRequest = z.infer<typeof DriveRewrapRequestSchema>;

export const DriveStateRequestSchema = z.object({ state: DriveStateSealedSchema }).strict();
export type DriveStateRequest = z.infer<typeof DriveStateRequestSchema>;

/** The caller's own Drive identity, sealed parts included -- only ever returned to its owner. */
export const DriveAccountSchema = z.object({
  userId: opaqueIdSchema,
  email: z.string(),
  encPublicKey: PublicKey,
  signPublicKey: PublicKey,
  privateKeys: DriveSealedSchema,
  passphraseWrap: DrivePassphraseWrapSchema,
  recoveryWrap: DriveRecoveryWrapSchema,
  state: DriveStateSealedSchema.nullable(),
  keyVersion: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DriveAccount = z.infer<typeof DriveAccountSchema>;

/** Staff who have set up the Drive: the only people a folder can be shared with. */
export const DriveDirectoryEntrySchema = z.object({
  userId: opaqueIdSchema,
  email: z.string(),
  encPublicKey: PublicKey,
  signPublicKey: PublicKey,
  keyVersion: z.number().int().min(1),
});
export type DriveDirectoryEntry = z.infer<typeof DriveDirectoryEntrySchema>;

export const DriveDirectorySchema = z.object({ entries: z.array(DriveDirectoryEntrySchema) });
export type DriveDirectory = z.infer<typeof DriveDirectorySchema>;

export const DRIVE_ROLES = ["owner", "editor", "viewer"] as const;
export const DriveRoleSchema = z.enum(DRIVE_ROLES);
export type DriveRole = z.infer<typeof DriveRoleSchema>;

/**
 * A folder's key, wrapped for one member: ECDH between a fresh ephemeral key and
 * the member's public key, then AES-GCM. Signed by whoever granted it, so a
 * server that invents a folder key of its own cannot pass it off as a colleague's.
 */
export const DriveMemberKeyInputSchema = z
  .object({ ephemeralPublicKey: PublicKey, iv: Iv, ct: WrappedKey, signature: Signature })
  .strict();
export type DriveMemberKeyInput = z.infer<typeof DriveMemberKeyInputSchema>;

export const DriveMemberKeySchema = DriveMemberKeyInputSchema.extend({
  keyGeneration: z.number().int().min(1),
  /**
   * Server-set: the session that signed this copy -- the granter, until the
   * member re-signs it as their own. Never taken from the client.
   */
  signedBy: opaqueIdSchema,
});
export type DriveMemberKey = z.infer<typeof DriveMemberKeySchema>;

/** A node's key, wrapped under its folder's current key. */
export const DriveNodeKeyInputSchema = z.object({ iv: Iv, ct: WrappedKey }).strict();
export type DriveNodeKeyInput = z.infer<typeof DriveNodeKeyInputSchema>;

export const DRIVE_NODE_KINDS = ["folder", "file"] as const;
export const DriveNodeKindSchema = z.enum(DRIVE_NODE_KINDS);
export type DriveNodeKind = z.infer<typeof DriveNodeKindSchema>;

export const DriveNodeSchema = z.object({
  id: opaqueIdSchema,
  shareId: opaqueIdSchema,
  parentId: opaqueIdSchema.nullable(),
  kind: DriveNodeKindSchema,
  nodeKey: DriveNodeKeyInputSchema.extend({ keyGeneration: z.number().int().min(1) }),
  meta: DriveMetaSealedSchema,
  revision: z.number().int().min(0),
  blockCount: z.number().int().min(0).max(DRIVE_MAX_BLOCKS),
  sizeBytes: z.number().int().min(0),
  /** SHA-256 over the per-block SHA-256s of the ciphertext; "" for a folder. */
  contentHash: z.union([Digest, z.literal("")]),
  signature: Signature,
  signedBy: opaqueIdSchema,
  createdBy: opaqueIdSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  trashedAt: z.string().nullable(),
});
export type DriveNode = z.infer<typeof DriveNodeSchema>;

export const DriveMemberSchema = z.object({
  userId: opaqueIdSchema,
  email: z.string(),
  role: DriveRoleSchema,
  keyGeneration: z.number().int().min(1),
  /** The member's account key version the folder key was wrapped for. */
  memberKeyVersion: z.number().int().min(1),
  grantedBy: opaqueIdSchema,
  createdAt: z.string(),
});
export type DriveMember = z.infer<typeof DriveMemberSchema>;

/** One shared folder as its member sees it: their wrapped key, their role, its root. */
export const DriveShareSummarySchema = z.object({
  shareId: opaqueIdSchema,
  role: DriveRoleSchema,
  keyGeneration: z.number().int().min(1),
  memberKey: DriveMemberKeySchema,
  memberCount: z.number().int().min(1),
  root: DriveNodeSchema,
});
export type DriveShareSummary = z.infer<typeof DriveShareSummarySchema>;

export const DriveShareListSchema = z.object({ shares: z.array(DriveShareSummarySchema) });
export type DriveShareList = z.infer<typeof DriveShareListSchema>;

export const DriveShareDetailSchema = z.object({
  share: DriveShareSummarySchema,
  /** Every committed node, trashed ones included (the trash is a view, not a place). */
  nodes: z.array(DriveNodeSchema),
  members: z.array(DriveMemberSchema),
});
export type DriveShareDetail = z.infer<typeof DriveShareDetailSchema>;

const NewNodeFields = {
  nodeId: opaqueIdSchema,
  nodeKey: DriveNodeKeyInputSchema,
  meta: DriveMetaSealedSchema,
  signature: Signature,
};

export const DriveShareCreateRequestSchema = z
  .object({
    shareId: opaqueIdSchema,
    root: z.object(NewNodeFields).strict(),
    ownerKey: DriveMemberKeyInputSchema,
  })
  .strict();
export type DriveShareCreateRequest = z.infer<typeof DriveShareCreateRequestSchema>;

export const DriveFolderCreateRequestSchema = z
  .object({
    ...NewNodeFields,
    parentId: opaqueIdSchema,
    keyGeneration: z.number().int().min(1),
  })
  .strict();
export type DriveFolderCreateRequest = z.infer<typeof DriveFolderCreateRequestSchema>;

/**
 * Starts a file revision. A new file carries its parent and wrapped key; a new
 * revision of an existing file carries neither, and must be `revision + 1`.
 */
export const DriveUploadStartRequestSchema = z
  .object({
    nodeId: opaqueIdSchema,
    revision: z.number().int().min(1),
    newFile: z
      .object({
        parentId: opaqueIdSchema,
        nodeKey: DriveNodeKeyInputSchema,
        keyGeneration: z.number().int().min(1),
      })
      .strict()
      .optional(),
    blockCount: z.number().int().min(0).max(DRIVE_MAX_BLOCKS),
    sizeBytes: z
      .number()
      .int()
      .min(0)
      .max(DRIVE_MAX_BLOCKS * DRIVE_BLOCK_MAX_BYTES),
    contentHash: Digest,
    meta: DriveMetaSealedSchema,
    signature: Signature,
  })
  .strict();
export type DriveUploadStartRequest = z.infer<typeof DriveUploadStartRequestSchema>;

export const DriveUploadStartResponseSchema = z.object({
  nodeId: opaqueIdSchema,
  revision: z.number().int().min(1),
});
export type DriveUploadStartResponse = z.infer<typeof DriveUploadStartResponseSchema>;

/** Edge -> worker: one block, base64 because the internal hop is JSON. */
export const DriveBlockSchema = z.object({ data: base64Bytes(1, DRIVE_BLOCK_MAX_BYTES) }).strict();
export type DriveBlock = z.infer<typeof DriveBlockSchema>;

export const DriveRenameRequestSchema = z
  .object({ meta: DriveMetaSealedSchema, signature: Signature })
  .strict();
export type DriveRenameRequest = z.infer<typeof DriveRenameRequestSchema>;

export const DriveMoveRequestSchema = z.object({ parentId: opaqueIdSchema }).strict();
export type DriveMoveRequest = z.infer<typeof DriveMoveRequestSchema>;

export const DriveMemberAddRequestSchema = z
  .object({
    userId: opaqueIdSchema,
    role: DriveRoleSchema,
    keyGeneration: z.number().int().min(1),
    memberKey: DriveMemberKeyInputSchema,
  })
  .strict();
export type DriveMemberAddRequest = z.infer<typeof DriveMemberAddRequestSchema>;

/**
 * A member re-signs their own copy of the folder key the first time they open
 * it, after verifying who granted it. From then on their access no longer
 * depends on the granter's keys -- which may later be reset -- and the server
 * still cannot forge it, because it cannot sign as them.
 */
export const DriveMemberKeyAcceptRequestSchema = z
  .object({ keyGeneration: z.number().int().min(1), memberKey: DriveMemberKeyInputSchema })
  .strict();
export type DriveMemberKeyAcceptRequest = z.infer<typeof DriveMemberKeyAcceptRequestSchema>;

export const DriveMemberRoleRequestSchema = z.object({ role: DriveRoleSchema }).strict();
export type DriveMemberRoleRequest = z.infer<typeof DriveMemberRoleRequestSchema>;

/**
 * Removing someone rotates the folder key in the same request: a new key wrapped
 * for every remaining member, and every node key rewrapped under it. The server
 * refuses a rotation that leaves out a member or a node, so there is no state in
 * which a removed person's key still opens new content.
 */
export const DriveMemberRemoveRequestSchema = z
  .object({
    keyGeneration: z.number().int().min(2),
    memberKeys: z
      .array(z.object({ userId: opaqueIdSchema, memberKey: DriveMemberKeyInputSchema }).strict())
      .max(DRIVE_MEMBERS_MAX),
    nodeKeys: z
      .array(z.object({ nodeId: opaqueIdSchema, nodeKey: DriveNodeKeyInputSchema }).strict())
      .max(DRIVE_NODES_MAX),
  })
  .strict();
export type DriveMemberRemoveRequest = z.infer<typeof DriveMemberRemoveRequestSchema>;

export const DriveKeyGenerationResultSchema = z.object({ keyGeneration: z.number().int().min(1) });
export type DriveKeyGenerationResult = z.infer<typeof DriveKeyGenerationResultSchema>;

export const DrivePurgeResultSchema = z.object({ purged: z.number().int().min(0) });
export type DrivePurgeResult = z.infer<typeof DrivePurgeResultSchema>;

/**
 * Why the Drive refused something, in `error.details.reason`. Stable strings the
 * console translates; the error `code` stays one of the platform's own.
 */
export const DRIVE_ERROR_REASONS = [
  "drive_account_missing",
  "drive_account_exists",
  "drive_not_a_member",
  "drive_role_insufficient",
  "drive_stale_key_generation",
  "drive_incomplete_rotation",
  "drive_last_owner",
  "drive_invalid_parent",
  "drive_root_node",
  "drive_not_trashed",
  "drive_upload_incomplete",
  "drive_revision_conflict",
  "drive_limit_reached",
  "drive_recipient_unknown",
  "drive_already_member",
] as const;
export const DriveErrorReasonSchema = z.enum(DRIVE_ERROR_REASONS);
export type DriveErrorReason = z.infer<typeof DriveErrorReasonSchema>;
