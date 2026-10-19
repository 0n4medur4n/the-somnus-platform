import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountDeletionRepository } from "../../src/infrastructure/db/repositories/account-deletion.repository.js";
import { StaffInvitationsRepository } from "../../src/infrastructure/db/repositories/staff-invitations.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { staffInvitations } from "../../src/infrastructure/db/schema/index.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

const DAY = 24 * 60 * 60 * 1000;

/** Staff invitations at the repository level (owner decision 2026-10-18). */
describe("StaffInvitationsRepository", () => {
  const db = getTestDb();
  const repo = new StaffInvitationsRepository(db);
  const users = new UsersRepository(db);
  const inviter = UUIDv7();

  const invite = (email: string, expiresAt = new Date(Date.now() + 7 * DAY)) =>
    repo.replacePending({
      email,
      firstName: "Ana",
      lastName: "García",
      roleKey: "support_agent",
      locale: "es",
      invitedBy: inviter,
      expiresAt,
    });

  beforeEach(async () => {
    await resetTables();
  });

  it("creates a pending invitation and finds it by id and by address", async () => {
    const row = await invite("ana@example.com");
    expect(row).toMatchObject({
      email: "ana@example.com",
      status: "pending",
      acceptedUserId: null,
    });
    expect((await repo.findById(row.id))?.id).toBe(row.id);
    expect((await repo.findUsableByEmail("ana@example.com", new Date()))?.id).toBe(row.id);
  });

  it("answers null for an unknown id and for an address with nothing usable", async () => {
    expect(await repo.findById(UUIDv7())).toBeNull();
    expect(await repo.findUsableByEmail("nobody@example.com", new Date())).toBeNull();
    await invite("old@example.com", new Date(Date.now() - DAY));
    expect(await repo.findUsableByEmail("old@example.com", new Date())).toBeNull();
  });

  it("a new invitation to the same address revokes the pending one", async () => {
    const first = await invite("ana@example.com");
    const second = await invite("ana@example.com");
    expect((await repo.findById(first.id))?.status).toBe("revoked");
    expect((await repo.findUsableByEmail("ana@example.com", new Date()))?.id).toBe(second.id);
    expect((await repo.listRecent(10)).map((r) => r.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(await repo.listRecent(1)).toHaveLength(1);
  });

  it("revokes and accepts only from pending, exactly once", async () => {
    const revoked = await invite("rev@example.com");
    expect(await repo.revoke(revoked.id)).toBe(true);
    expect(await repo.revoke(revoked.id)).toBe(false);
    expect(await repo.markAccepted(revoked.id, UUIDv7(), new Date())).toBe(false);

    const accepted = await invite("acc@example.com");
    const userId = UUIDv7();
    expect(await repo.markAccepted(accepted.id, userId, new Date())).toBe(true);
    expect(await repo.markAccepted(accepted.id, UUIDv7(), new Date())).toBe(false);
    expect(await repo.revoke(accepted.id)).toBe(false);
    const row = await repo.findById(accepted.id);
    expect(row).toMatchObject({ status: "accepted", acceptedUserId: userId });
    expect(row?.acceptedAt).toBeInstanceOf(Date);
  });

  it("erasing an account erases its own invitation and the ones it issued, nobody else's", async () => {
    const person = await users.create({ email: "person@example.com" });
    const own = await invite("person@example.com");
    await repo.markAccepted(own.id, person, new Date());
    const issued = await repo.replacePending({
      email: "someone@example.com",
      firstName: "Luis",
      lastName: "Pérez",
      roleKey: "platform_admin",
      locale: "es",
      invitedBy: person,
      expiresAt: new Date(Date.now() + DAY),
    });
    const unrelated = await invite("other@example.com");

    await new AccountDeletionRepository(db).eraseIdentityData(person);

    const left = await db.select({ id: staffInvitations.id }).from(staffInvitations);
    expect(left.map((r) => r.id)).toEqual([unrelated.id]);
    expect(await repo.findById(issued.id)).toBeNull();
    expect(await db.select().from(staffInvitations).where(eq(staffInvitations.id, own.id))).toEqual(
      [],
    );
  });
});
