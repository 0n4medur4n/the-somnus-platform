import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { IndividualProfilesRepository } from "../../src/infrastructure/db/repositories/individual-profiles.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { individualProfiles } from "../../src/infrastructure/db/schema/index.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("UsersRepository", () => {
  const repo = new UsersRepository(getTestDb());

  beforeEach(async () => {
    await resetTables();
  });

  it("creates a user and finds it by id and email", async () => {
    const id = await repo.create({ email: "ada@example.com" });
    const byId = await repo.findById(id);
    const byEmail = await repo.findByEmail("ada@example.com");

    expect(byId?.id).toBe(id);
    expect(byId?.locale).toBe("es");
    expect(byEmail?.id).toBe(id);
  });

  it("findById returns null for an unknown id", async () => {
    expect(await repo.findById(UUIDv7())).toBeNull();
  });

  it("links a Firebase identity and finds the user by provider id", async () => {
    const userId = await repo.create({ email: "grace@example.com" });
    await repo.linkIdentity({ userId, providerUserId: "firebase-uid-123" });

    const identity = await repo.findByProviderUserId("firebase-uid-123");
    expect(identity?.userId).toBe(userId);
  });

  /** The console overview's aggregates, against the real schema (counts only). */
  it("aggregates accounts by status, registration role and sign-up day", async () => {
    const db = getTestDb();
    const profiles = new IndividualProfilesRepository(db);
    const adult = await repo.create({ email: "a@example.com" });
    const pro = await repo.create({ email: "p@example.com" });
    const bare = await repo.create({ email: "b@example.com" });
    await repo.setStatus(bare, "suspended");
    for (const [userId, role] of [
      [adult, "adult"],
      [pro, "professional"],
    ] as const) {
      await profiles.create({ userId, firstName: "X", lastName: "Y" });
      await db
        .update(individualProfiles)
        .set({ registrationRole: role })
        .where(eq(individualProfiles.userId, userId));
    }

    const raw = await repo.overviewForAdmin(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const status = Object.fromEntries(raw.byStatus.map((r) => [r.status, Number(r.total)]));
    expect(status).toEqual({ active: 2, suspended: 1 });
    const roles = Object.fromEntries(raw.byRole.map((r) => [String(r.role), Number(r.total)]));
    expect(roles).toEqual({ adult: 1, professional: 1, null: 1 });
    expect(raw.daily.reduce((n, d) => n + Number(d.total), 0)).toBe(3);
    expect(raw.daily[0]?.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
