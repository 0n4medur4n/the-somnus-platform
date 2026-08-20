import { describe, expect, it } from "vitest";
import type { AuditRecordInput } from "../src/modules/audit/db/repositories/index.js";
import { redactForExport } from "../src/modules/audit/export/audit-exporter.js";

const record: AuditRecordInput = {
  eventId: "e1",
  eventType: "identity.user.created.v1",
  occurredAt: "2026-08-20T12:00:00Z",
  producer: "identity-service",
  correlationId: "corr-1",
  actorType: "user",
  actorId: "user-1234", // PII: must not be exported
  subjectType: "user",
  subjectId: "user-9999", // PII: must not be exported
  data: {
    route: "signup",
    token: "sekret-token", // forbidden
    email: "person@example.com", // forbidden
    password: "hunter2", // forbidden
    answers: ["a", "b"], // forbidden
  },
};

describe("redactForExport (BigQuery privacy-safe export)", () => {
  it("drops actor/subject ids and every forbidden data field", () => {
    const row = redactForExport(record);

    // Provenance types survive; ids do not.
    expect(row.actorType).toBe("user");
    expect(row).not.toHaveProperty("actorId");
    expect(row).not.toHaveProperty("subjectId");

    // Only the safe data key survives.
    expect(row.data).toEqual({ route: "signup" });

    // No forbidden value can appear anywhere in the serialized export.
    const serialized = JSON.stringify(row);
    for (const secret of [
      "sekret-token",
      "person@example.com",
      "hunter2",
      "user-1234",
      "user-9999",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("is case-insensitive on forbidden keys", () => {
    const row = redactForExport({ ...record, data: { Token: "x", EMAIL: "y", ok: 1 } });
    expect(row.data).toEqual({ ok: 1 });
  });
});
