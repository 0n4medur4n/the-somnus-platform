import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuditDb, createAuditPool } from "../../src/modules/audit/db/audit-db.client.js";
import { loadAuditDbConfig } from "../../src/modules/audit/db/audit-db.config.js";
import type { AuditRecordInput } from "../../src/modules/audit/db/repositories/index.js";
import { AuditRepository } from "../../src/modules/audit/db/repositories/index.js";
import { auditRecords } from "../../src/modules/audit/db/schema/index.js";

const pool = createAuditPool(loadAuditDbConfig(process.env));
const db = createAuditDb(pool);
const repo = new AuditRepository(db);

const input: AuditRecordInput = {
  eventId: "33333333-3333-3333-3333-333333333333",
  eventType: "morpheo.assessment.completed.v1",
  occurredAt: "2026-08-20T12:00:00Z",
  producer: "morpheo-service",
  correlationId: "corr-1",
  actorType: "user",
  actorId: "u1",
  subjectType: "assessment",
  subjectId: "a1",
  data: { routes: ["INS"], count: 2 },
};

beforeEach(async () => {
  await db.delete(auditRecords);
});

afterAll(async () => {
  await pool.end();
});

describe("AuditRepository", () => {
  it("persists a record and reads it back by event id, data JSON intact", async () => {
    const id = await repo.create(input);
    const row = await repo.findByEventId(input.eventId);

    expect(row?.id).toBe(id);
    expect(row?.producer).toBe("morpheo-service");
    expect(row?.data).toEqual({ routes: ["INS"], count: 2 });
  });

  it("enforces one record per event id (unique)", async () => {
    await repo.create(input);
    await expect(repo.create(input)).rejects.toThrow();
  });

  it("returns null for an unknown event id", async () => {
    expect(await repo.findByEventId("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
