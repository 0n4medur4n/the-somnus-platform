import { UUIDv7 } from "@somnus/api-contracts";
import { and, count, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import {
  PasskeyCredentialExpiryRequired,
  PasskeyCredentialIdConflict,
} from "../../../domain/passkey/passkey.js";
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
  /** Required. A missing or invalid deadline is refused before insert. */
  pendingExpiresAt: Date;
  /** The counter reported at registration. Omitted means zero. */
  signCount?: number;
};

export type PasskeyCredentialRecord = typeof passkeyCredentials.$inferSelect;

export interface PasskeyCredentialStore {
  create(input: NewPasskeyCredential): Promise<UUIDv7>;
  findByCredentialId(credentialId: Buffer): Promise<PasskeyCredentialRecord | null>;
  listByUser(scope: UserScope): Promise<PasskeyCredentialRecord[]>;
  countActiveByUser(scope: UserScope): Promise<number>;
  countPendingByUser(scope: UserScope, now: Date): Promise<number>;
  activate(scope: UserScope, credentialId: Buffer, now: Date): Promise<boolean>;
  /**
   * Pending to active, and the new counter, in one conditional update.
   * The stored counter must still be `expectedSignCount`. A second
   * concurrent call matches nothing.
   */
  completePendingSignIn(
    scope: UserScope,
    credentialId: Buffer,
    expectedSignCount: number,
    signCount: number,
    now: Date,
  ): Promise<boolean>;
  /**
   * One conditional update of an active credential. The stored counter
   * and `last_used_at` must still be the values the caller read, so two
   * requests that observed the same counter cannot both succeed.
   */
  recordUse(
    scope: UserScope,
    credentialId: Buffer,
    expectedSignCount: number,
    signCount: number,
    usedAt: Date,
    expectedLastUsedAt: Date | null,
  ): Promise<boolean>;
  lock(scope: UserScope, credentialId: Buffer, lockedAt: Date): Promise<boolean>;
  /** Lock a pending or active credential only while its counter is unchanged. */
  lockAtSignCount(
    scope: UserScope,
    credentialId: Buffer,
    expectedSignCount: number,
    lockedAt: Date,
  ): Promise<boolean>;
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
    const pendingExpiresAt = input.pendingExpiresAt;
    if (!(pendingExpiresAt instanceof Date) || Number.isNaN(pendingExpiresAt.getTime())) {
      throw new PasskeyCredentialExpiryRequired();
    }
    await assertPasskeyUser(this.db, input.userId);
    const id = UUIDv7();
    try {
      await this.db.insert(passkeyCredentials).values({
        id,
        credentialId: input.credentialId,
        userId: input.userId,
        publicKey: input.publicKey,
        coseAlgorithm: input.coseAlgorithm,
        signCount: input.signCount ?? 0,
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

  /** Unexpired, not activated, not revoked, not locked. Expired rows do not count. */
  async countPendingByUser(scope: UserScope, now: Date): Promise<number> {
    const rows = await this.db
      .select({ total: count() })
      .from(passkeyCredentials)
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          isNull(passkeyCredentials.activatedAt),
          isNull(passkeyCredentials.revokedAt),
          isNull(passkeyCredentials.lockedAt),
          gt(passkeyCredentials.pendingExpiresAt, now),
        ),
      );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Pending to active in one conditional update. A second call on an
   * already-active credential changes nothing (the timestamps stay) and
   * still reports success. Revoked, locked, expired-pending, a missing
   * deadline, and another user's credential are refused. The read below
   * does not write.
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
          gt(passkeyCredentials.pendingExpiresAt, now),
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

  async completePendingSignIn(
    scope: UserScope,
    credentialId: Buffer,
    expectedSignCount: number,
    signCount: number,
    now: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ activatedAt: now, lastUsedAt: now, signCount })
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          eq(passkeyCredentials.credentialId, credentialId),
          isNull(passkeyCredentials.activatedAt),
          isNull(passkeyCredentials.revokedAt),
          isNull(passkeyCredentials.lockedAt),
          gt(passkeyCredentials.pendingExpiresAt, now),
          eq(passkeyCredentials.signCount, expectedSignCount),
        ),
      );
    return (updated[0].affectedRows ?? 0) === 1;
  }

  async recordUse(
    scope: UserScope,
    credentialId: Buffer,
    expectedSignCount: number,
    signCount: number,
    usedAt: Date,
    expectedLastUsedAt: Date | null,
  ): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ signCount, lastUsedAt: usedAt })
      .where(
        and(
          isActiveSql(scope, credentialId),
          eq(passkeyCredentials.signCount, expectedSignCount),
          expectedLastUsedAt === null
            ? isNull(passkeyCredentials.lastUsedAt)
            : eq(passkeyCredentials.lastUsedAt, expectedLastUsedAt),
        ),
      );
    return (updated[0].affectedRows ?? 0) === 1;
  }

  async lock(scope: UserScope, credentialId: Buffer, lockedAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ lockedAt })
      .where(and(isActiveSql(scope, credentialId), isNull(passkeyCredentials.lockedAt)));
    return (updated[0].affectedRows ?? 0) === 1;
  }

  /**
   * Locks the credential the ceremony just judged, pending or active, and
   * only while the counter is still the one it read. A concurrent update
   * that moved the counter is left alone.
   */
  async lockAtSignCount(
    scope: UserScope,
    credentialId: Buffer,
    expectedSignCount: number,
    lockedAt: Date,
  ): Promise<boolean> {
    const updated = await this.db
      .update(passkeyCredentials)
      .set({ lockedAt })
      .where(
        and(
          eq(passkeyCredentials.userId, scope.userId),
          eq(passkeyCredentials.credentialId, credentialId),
          isNull(passkeyCredentials.revokedAt),
          isNull(passkeyCredentials.lockedAt),
          eq(passkeyCredentials.signCount, expectedSignCount),
        ),
      );
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
