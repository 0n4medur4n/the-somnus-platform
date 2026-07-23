import { beforeEach, describe, expect, it } from "vitest";
import { AuditRepository } from "../../src/infrastructure/db/repositories/audit.repository.js";
import { UsersRepository } from "../../src/infrastructure/db/repositories/users.repository.js";
import { getTestDb, resetTables } from "./db-test-helper.js";

describe("AuditRepository", () => {
  const db = getTestDb();
  const users = new UsersRepository(db);
  const repo = new AuditRepository(db);

  beforeEach(async () => {
    await resetTables();
  });

  it("records and lists audit events scoped to the subject", async () => {
    const subject = await users.create({ email: "subject@example.com" });
    const other = await users.create({ email: "other@example.com" });
    await repo.recordEvent({
      eventType: "profile.updated",
      subjectUserId: subject,
      data: { field: "name" },
    });
    await repo.recordEvent({ eventType: "profile.updated", subjectUserId: other });

    const events = await repo.listEventsForSubject({ userId: subject });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("profile.updated");
  });

  it("audit event data never needs to carry health data to be useful (build plan §19/§21 spirit)", async () => {
    const subject = await users.create({ email: "redacted@example.com" });
    await repo.recordEvent({
      eventType: "consent.recorded",
      subjectUserId: subject,
      data: { purpose: "marketing" },
    });

    const [event] = await repo.listEventsForSubject({ userId: subject });
    expect(event?.data).toEqual({ purpose: "marketing" });
  });

  it("records and lists account status history scoped to the user", async () => {
    const userId = await users.create({ email: "status@example.com" });
    await repo.recordStatusChange({ userId, previousStatus: "active", newStatus: "suspended" });

    const history = await repo.listStatusHistory({ userId });
    expect(history).toHaveLength(1);
    expect(history[0]?.newStatus).toBe("suspended");
  });

  it("records and lists session revocations scoped to the user", async () => {
    const userId = await users.create({ email: "session@example.com" });
    await repo.recordSessionRevocation({ userId, reason: "password changed" });

    const revocations = await repo.listSessionRevocations({ userId });
    expect(revocations).toHaveLength(1);
    expect(revocations[0]?.reason).toBe("password changed");
  });

  it("requests deletion and finds the pending request scoped to the user", async () => {
    const userId = await users.create({ email: "delete-me@example.com" });
    await repo.requestDeletion({ userId });

    const pending = await repo.findPendingDeletionRequest({ userId });
    expect(pending?.status).toBe("pending");
  });

  it("a user's deletion request is invisible under a different user's scope", async () => {
    const userA = await users.create({ email: "delA@example.com" });
    const userB = await users.create({ email: "delB@example.com" });
    await repo.requestDeletion({ userId: userA });

    expect(await repo.findPendingDeletionRequest({ userId: userB })).toBeNull();
  });
});
