import { UUIDv7 } from "@somnus/api-contracts";
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { PasskeyCredentialIdConflict } from "../../../domain/passkey/passkey.js";
import type { Db } from "../db.client.js";
import { passkeyCredentials } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";
import { assertPasskeyUser } from "./passkey-user.js";

/** Opportunistic cap for `deleteExpiredPending`. Callers cannot raise it. */
export const PASSKEY_PENDING_CLEANUP_LIMIT = 100;

export type NewPasskeyCredential = {
  userId: UUIDv7;
  credentialId: Buffer;
  publicKey: Buffer;
  coseAlgorithm: number;
  transports: string[] | null;
  aaguid: Buffer | null;
  backupEligible: boolean;
  backupState: boolean;
  name: string;
  pendingExpiresAt: Date | null;
};

export type PasskeyCredentialRecord = typeof passkeyCredentials.$inferSelect;

export interface PasskeyCredentialStore {
  create(input: NewPasskeyCredential): Promise<UUIDv7>;
  findByCredentialId(credentialId: Buffer): Promise<PasskeyCredentialRecord | null>;
  listByUser(scope: UserScope): Promise<PasskeyCredentialRecord[]>;
  countActiveByUser(scope: UserScope): Promise<number>;
  activate(scope: UserScope, credentialId: Buffer, now: Date): Promise<boolean>;
  recordUse(
    scope: UserScope,
    credentialId: Buffer,
    signCount: number,
    usedAt: Date,
  ): Promise<boolean>;
  lock(scope: UserScope, credentialId: Buffer, lockedAt: Date): Promise<boolean>;
  revoke(scope: UserScope, credentialId: Buffer, revokedAt: Date): Promise<boolean>;
  revokeAllForUser(scope: UserScope, revokedAt: Date): Promise<UUIDv7[]>;
  rename(scope: UserScope, credentialId: Buffer, name: string): Promise<boolean>;
  deleteExpiredPending(limit: number): Promise<number>;
}

function isDuplicateEntry(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current !== "object" || current === null) return false;
    const record = current as { errno?: unknown; code?: unknown; cause?: unknown };
    if (record.errno === 1062 || record.code === "ER_DUP_ENTRY") return true;
    current = record.cause;
  }
  return false;
}

function isActiveSql(scope: UserScope, credentialId: Buffer) {
  return and(
    eq(passkeyCredentials.userId, scope.userId),
    eq(passkeyCredentials.credentialId, credentialId),
    isNotNull(passkeyCredentials.activatedAt),
    isNull(passkeyCredentials.revokedAt),
    isNull(passkeyCredentials.lockedAt),
  );
}

/**
 * MySQL store for console passkey credentials. Relations to `users` are
 * checked here, not by a foreign key (schema/index.ts).
 */
export class PasskeyCredentialsRepository implements PasskeyCredentialStore {
  constructor(private readonly db: Db) {}

  async create(input: NewPasskeyCredential): Promise<UUIDv7> {
    await assertPasskeyUser(this.db, input.userId);
    const id = UUIDv7();
    try {
      await this.db.insert(passkeyCredentials).values({
        id,
        credentialId: input.credentialId,
        userId: input.userId,
        publicKey: input.publicKey,
        coseAlgorithm: input.coseAlgorithm,
        signCount: 0,
        transports: input.transports,
        aaguid: input.aaguid,
        backupEligible: input.backupEligible,
        backupState: input.backupState,
        name: input.name,
        pendingExpiresAt: input.pendingExpiresAt,
      });
    } catch (error: unknown) {
      if (isDuplicateEntry(error)) throw new PasskeyCredentialIdConflict();
      throw error;
    }
    return id;
  }

  /**
   * Deliberately NOT user-scoped: the ceremony looks a credential up by
   * the authenticator's credential id, which is the unguessable key, and
   * the row is what yields the user.
   */
  async findByCredentialId(credentialId: Buffer): Promise<PasskeyCredentialRecord | null> {
    const rows = await this.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.credentialId, credentialId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByUser(scope: UserScope): Promise<PasskeyCredentialRecord[]> {
    return this.db
      .select()
      .from(passkeyCredentials)
      .where(eq(passkeyCredentials.userId, scope.userId))
      .orderBy(passkeyCredentials.createdAt);
  }

  async countActiveByUser(scope: UserScope): Promise<number> {
    const rows = await this.db
      .select({ total: count() })
      .from(passkeyCredentials)
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          isNotNull(passkeyCredentials.activatedAt),
          isNull(passkeyCredentials.revokedAt),
          isNull(passkeyCredentials.lockedAt),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Pending to active in one conditional update. A second call on an
   * already-active credential changes nothing (the timestamps stay) and
   * still reports success. Revoked, locked, expired-pending, and another
   * user's credential are refused. The read below does not write.
   */
  async activate(scope: UserScope, credentialId: Buffer, now: Date): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ activatedAt: now, lastUsedAt: now })
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          eq(passkeyCredentials.credentialId, credentialId),
          isNull(passkeyCredentials.activatedAt),
          isNull(passkeyCredentials.revokedAt),
          isNull(passkeyCredentials.lockedAt),
          or(
            isNull(passkeyCredentials.pendingExpiresAt),
            gt(passkeyCredentials.pendingExpiresAt, now),
          ),
        ),
      );
    if ((updated[0].affectedRows ?? 0) === 1) return true;

    const rows = await this.db
      .select({
        activatedAt: passkeyCredentials.activatedAt,
        revokedAt: passkeyCredentials.revokedAt,
        lockedAt: passkeyCredentials.lockedAt,
      })
      .from(passkeyCredentials)
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          eq(passkeyCredentials.credentialId, credentialId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row?.activatedAt != null && row.revokedAt == null && row.lockedAt == null;
  }

  async recordUse(
    scope: UserScope,
    credentialId: Buffer,
    signCount: number,
    usedAt: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ signCount, lastUsedAt: usedAt })
      .where(isActiveSql(scope, credentialId));
    return (updated[0].affectedRows ?? 0) === 1;
  }

  async lock(scope: UserScope, credentialId: Buffer, lockedAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ lockedAt })
      .where(and(isActiveSql(scope, credentialId), isNull(passkeyCredentials.lockedAt)));
    return (updated[0].affectedRows ?? 0) === 1;
  }

  async revoke(scope: UserScope, credentialId: Buffer, revokedAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ revokedAt })
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          eq(passkeyCredentials.credentialId, credentialId),
          isNull(passkeyCredentials.revokedAt),
        ),
      );
    return (updated[0].affectedRows ?? 0) === 1;
  }

  async revokeAllForUser(scope: UserScope, revokedAt: Date): Promise<UUIDv7[]> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(
          and(eq(passkeyCredentials.userId, scope.userId), isNull(passkeyCredentials.revokedAt)),
        )
        .for("update");
      const ids = rows.map((row) => row.id as UUIDv7);
      if (ids.length === 0) return [];
      await tx
        .update(passkeyCredentials)
        .set({ revokedAt })
        .where(
          and(
            eq(passkeyCredentials.userId, scope.userId),
            inArray(passkeyCredentials.id, ids),
            isNull(passkeyCredentials.revokedAt),
          ),
        );
      return ids;
    });
  }

  async rename(scope: UserScope, credentialId: Buffer, name: string): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ name })
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          eq(passkeyCredentials.credentialId, credentialId),
        ),
      );
    return (updated[0].affectedRows ?? 0) === 1;
  }

  /**
   * Deliberately NOT user-scoped: a bounded sweep of expired pending
   * rows for every user. It returns a count, never a credential.
   * Active rows are not pending, so a past `pending_expires_at` on an
   * activated credential is left alone.
   */
  async deleteExpiredPending(limit: number): Promise<number> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 0), PASSKEY_PENDING_CLEANUP_LIMIT);
    if (bounded === 0) return 0;
    const deleted = await this.db
      .delete(passkeyCredentials)
      .where(
        and(
          isNull(passkeyCredentials.activatedAt),
          isNotNull(passkeyCredentials.pendingExpiresAt),
          lt(passkeyCredentials.pendingExpiresAt, new Date()),
        ),
      )
      .limit(bounded);
    return deleted[0].affectedRows ?? 0;
  }
}
