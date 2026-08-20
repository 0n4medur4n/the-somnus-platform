import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createNotificationDb,
  createNotificationPool,
} from "../../src/modules/notification/db/notification-db.client.js";
import { loadNotificationDbConfig } from "../../src/modules/notification/db/notification-db.config.js";
import { DeliveriesRepository } from "../../src/modules/notification/db/repositories/index.js";
import { notificationDeliveries } from "../../src/modules/notification/db/schema/index.js";

const pool = createNotificationPool(loadNotificationDbConfig(process.env));
const db = createNotificationDb(pool);
const repo = new DeliveriesRepository(db);

const base = {
  type: "invitation" as const,
  recipient: "person@example.com",
  locale: "es" as const,
};

beforeEach(async () => {
  await db.delete(notificationDeliveries);
});

afterAll(async () => {
  await pool.end();
});

describe("DeliveriesRepository", () => {
  it("creates a delivery and finds it by idempotency key", async () => {
    const id = await repo.create({ idempotencyKey: "invite:1", ...base });
    const row = await repo.findByIdempotencyKey("invite:1");
    expect(row?.id).toBe(id);
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
  });

  it("returns null for a missing idempotency key or id", async () => {
    expect(await repo.findByIdempotencyKey("does-not-exist")).toBeNull();
    expect(await repo.findById("does-not-exist")).toBeNull();
  });

  it("enforces idempotency: the same key cannot be inserted twice", async () => {
    await repo.create({ idempotencyKey: "invite:dup", ...base });
    await expect(repo.create({ idempotencyKey: "invite:dup", ...base })).rejects.toThrow();
    // Exactly one row survives.
    expect(await repo.findByIdempotencyKey("invite:dup")).not.toBeNull();
  });

  it("transitions through sent / failed (attempt++) / dead-letter", async () => {
    const id = await repo.create({ idempotencyKey: "invite:tx", ...base });

    await repo.markFailed(id, "brevo 500");
    let row = await repo.findById(id);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("brevo 500");

    await repo.markFailed(id, "brevo 500 again");
    row = await repo.findById(id);
    expect(row?.attempts).toBe(2);

    await repo.markDeadLetter(id, "max attempts");
    row = await repo.findById(id);
    expect(row?.status).toBe("dead_letter");

    await repo.markSent(id, "brevo-msg-123");
    row = await repo.findById(id);
    expect(row?.status).toBe("sent");
    expect(row?.providerMessageId).toBe("brevo-msg-123");
    expect(row?.lastError).toBeNull();
  });
});
