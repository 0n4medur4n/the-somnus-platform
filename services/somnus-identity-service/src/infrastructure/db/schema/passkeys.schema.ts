import {
  boolean,
  customType,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  smallint,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { PASSKEY_CHALLENGE_PURPOSES } from "../../../domain/passkey/passkey.js";

/**
 * Opaque octets, kept as a Buffer.
 *
 * Drizzle's built-in `binary` / `varbinary` columns decode with
 * `Buffer.toString()`, which is UTF-8 and cannot round-trip a WebAuthn
 * credential id (arbitrary bytes, including 0x00 and 0xFF). This builder
 * writes the SQL type we ask for and returns the driver's bytes unchanged.
 * mysql2 hands BINARY / VARBINARY back as a Buffer.
 */
const mysqlBytes = customType<{
  data: Buffer;
  driverData: Buffer;
  config: { sqlType: string };
  configRequired: true;
}>({
  dataType(config) {
    return config.sqlType;
  },
  toDriver(value) {
    return value;
  },
  fromDriver(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    throw new Error("Passkey byte column did not come back as bytes.");
  },
});

const bytes = (name: string, sqlType: string) => mysqlBytes(name, { sqlType });

/** UUIDv7 primary keys, app-generated, matching every other identity table. */
const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/**
 * A WebAuthn credential registered for the admin console (ADR 0027).
 *
 * No foreign key to `users`: this schema declares none (see schema/index.ts,
 * ADR 0003). The repository refuses a credential whose user does not exist,
 * and account erasure deletes the row explicitly.
 *
 * Active means `activated_at` is set and `revoked_at` and `locked_at` are
 * both null. `activated_at` null means the credential is still pending.
 *
 * `credential_id` is VARBINARY(1023), not VARCHAR. The WebAuthn credential
 * id is up to 1023 opaque octets. A unique VARCHAR(1023) under utf8mb4 is
 * 4092 bytes and does not fit InnoDB's 3072-byte index key limit; 1023 raw
 * bytes do. The unique index is the ceremony's lookup key.
 */
export const passkeyCredentials = mysqlTable(
  "passkey_credentials",
  {
    id: id(),
    credentialId: bytes("credential_id", "varbinary(1023)").notNull(),
    userId: uuidRef("user_id").notNull(),
    publicKey: bytes("public_key", "varbinary(1024)").notNull(),
    coseAlgorithm: smallint("cose_algorithm").notNull(),
    signCount: int("sign_count", { unsigned: true }).notNull().default(0),
    transports: json("transports").$type<string[] | null>(),
    aaguid: bytes("aaguid", "binary(16)"),
    backupEligible: boolean("backup_eligible").notNull(),
    backupState: boolean("backup_state").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /**
     * Proposal, to confirm with the owner: an unactivated credential is
     * unusable once this instant has passed, and `deleteExpiredPending`
     * removes it. Null means the deadline has not been set yet (task 2.2
     * is what sets it). Activation of a pending row refuses a deadline
     * that is already past.
     */
    pendingExpiresAt: timestamp("pending_expires_at"),
    activatedAt: timestamp("activated_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    lockedAt: timestamp("locked_at"),
  },
  (table) => [
    uniqueIndex("passkey_credentials_credential_id_uidx").on(table.credentialId),
    index("passkey_credentials_user_id_idx").on(table.userId),
  ],
);

/**
 * A single-use WebAuthn challenge (ADR 0027, decision 6). 32 random bytes.
 * No personal data: `user_id` is null for usernameless authentication.
 * `expires_at` is indexed because consumption and the bounded cleanup both
 * filter on it. No foreign key; a challenge that names a user is refused
 * at the repository when that user does not exist, and erasure deletes the
 * user's rows.
 */
export const passkeyChallenges = mysqlTable(
  "passkey_challenges",
  {
    id: id(),
    challenge: bytes("challenge", "binary(32)").notNull(),
    purpose: mysqlEnum("purpose", [...PASSKEY_CHALLENGE_PURPOSES]).notNull(),
    userId: uuidRef("user_id"),
    sessionBindingHash: bytes("session_binding_hash", "binary(32)"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("passkey_challenges_challenge_uidx").on(table.challenge),
    index("passkey_challenges_expires_at_idx").on(table.expiresAt),
  ],
);

/**
 * The opaque WebAuthn user handle: 32 random bytes, one per user, unique.
 * Never derived from the email or the Somnus user id. The repository is
 * the only writer and uses a CSPRNG. No foreign key; erasure deletes it.
 */
export const passkeyUserHandles = mysqlTable(
  "passkey_user_handles",
  {
    id: id(),
    userId: uuidRef("user_id").notNull(),
    handle: bytes("handle", "binary(32)").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("passkey_user_handles_user_id_uidx").on(table.userId),
    uniqueIndex("passkey_user_handles_handle_uidx").on(table.handle),
  ],
);
