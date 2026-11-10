import type { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import { PasskeyUserNotFound } from "../../../domain/passkey/passkey.js";
import type { Db } from "../db.client.js";
import { users } from "../schema/index.js";

/**
 * The passkey tables do not declare a foreign key (schema/index.ts).
 * Every write that names a user checks the user row first.
 */
export async function assertPasskeyUser(db: Db, userId: UUIDv7): Promise<void> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) throw new PasskeyUserNotFound();
}
