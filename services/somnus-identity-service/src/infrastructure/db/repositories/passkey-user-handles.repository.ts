import { randomBytes } from "node:crypto";
import { UUIDv7 } from "@somnus/api-contracts";
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { passkeyUserHandles } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";
import { assertPasskeyUser } from "./passkey-user.js";

export interface PasskeyUserHandleStore {
  getOrCreateForUser(scope: UserScope): Promise<Buffer>;
  /** Read the handle. Does not create a row. */
  findForUser(scope: UserScope): Promise<Buffer | null>;
}

async function readHandle(db: Db, scope: UserScope): Promise<Buffer | null> {
  const rows = await db
    .select({ handle: passkeyUserHandles.handle })
    .from(passkeyUserHandles)
    .where(eq(passkeyUserHandles.userId, scope.userId))
    .limit(1);
  return rows[0]?.handle ?? null;
}

/**
 * One opaque WebAuthn user handle per user. The bytes come from a CSPRNG
 * and are never derived from the email or the Somnus user id. Two
 * concurrent calls insert one row: the loser hits the unique user id and
 * `ON DUPLICATE KEY UPDATE` leaves the winner's handle in place, then
 * both read it back.
 */
export class PasskeyUserHandlesRepository implements PasskeyUserHandleStore {
  constructor(private readonly db: Db) {}

  async getOrCreateForUser(scope: UserScope): Promise<Buffer> {
    await assertPasskeyUser(this.db, scope.userId);
    const existing = await readHandle(this.db, scope);
    if (existing) return existing;

    const handle = randomBytes(32);
    await this.db
      .insert(passkeyUserHandles)
      .values({ id: UUIDv7(), userId: scope.userId, handle })
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    const stored = await readHandle(this.db, scope);
    if (!stored) throw new Error("passkey user handle was not stored");
    return stored;
  }

  async findForUser(scope: UserScope): Promise<Buffer | null> {
    return readHandle(this.db, scope);
  }
}
