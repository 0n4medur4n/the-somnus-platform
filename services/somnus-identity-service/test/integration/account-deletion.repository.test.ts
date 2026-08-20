import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountDeletionRepository } from "../../src/infrastructure/db/repositories/account-deletion.repository.js";
import { AuditRepository } from "../../src/infrastructure/db/repositories/audit.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import {
  accessGrants,
  identityAuditEvents,
  individualProfiles,
  users,
} from "../../src/infrastructure/db/schema/index.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("AccountDeletionRepository (right to erasure, §13.2)", () => {
  const db = getTestDb();
  const repo = new AccountDeletionRepository(db);
  const usersRepo = new UsersRepository(db);
  const audit = new AuditRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  it("erases the user's personal data, retains the audit trail, leaves others intact", async () => {
    const userId = await usersRepo.create({ email: "erase@example.com" });
    const otherId = await usersRepo.create({ email: "keep@example.com" });
    await db
      .insert(individualProfiles)
      .values({ id: UUIDv7(), userId, firstName: "Ada", lastName: "L" });
    await db.insert(accessGrants).values({
      id: UUIDv7(),
      professionalUserId: otherId,
      subjectUserId: userId,
      grantedBy: otherId,
      scope: "read",
    });
    await audit.recordEvent({ eventType: "identity.test.event", subjectUserId: userId });

    await repo.eraseIdentityData(userId);

    // Personal data is gone.
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(0);
    expect(
      await db.select().from(individualProfiles).where(eq(individualProfiles.userId, userId)),
    ).toHaveLength(0);
    expect(
      await db.select().from(accessGrants).where(eq(accessGrants.subjectUserId, userId)),
    ).toHaveLength(0);

    // The audit trail is retained (build plan §21).
    expect(
      await db
        .select()
        .from(identityAuditEvents)
        .where(eq(identityAuditEvents.subjectUserId, userId)),
    ).toHaveLength(1);

    // Another user's account is untouched.
    expect(await db.select().from(users).where(eq(users.id, otherId))).toHaveLength(1);
  });
});
