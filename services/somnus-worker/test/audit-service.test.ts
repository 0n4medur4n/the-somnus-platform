import type { EventEnvelope } from "@somnus/api-contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/modules/audit/audit.service.js";
import type {
  AuditRecordInput,
  AuditRow,
  AuditStore,
} from "../src/modules/audit/db/repositories/index.js";

function makeRow(over: Partial<AuditRow>): AuditRow {
  return {
    id: "a1",
    eventId: "e1",
    eventType: "morpheo.assessment.completed.v1",
    occurredAt: "2026-08-20T12:00:00Z",
    producer: "morpheo-service",
    correlationId: "corr-1",
    actorType: null,
    actorId: null,
    subjectType: "assessment",
    subjectId: "s1",
    data: {},
    receivedAt: new Date(),
    ...over,
  };
}

class FakeStore implements AuditStore {
  rows = new Map<string, AuditRow>();
  created: AuditRecordInput[] = [];

  async findByEventId(eventId: string): Promise<AuditRow | null> {
    return this.rows.get(eventId) ?? null;
  }
  async create(input: AuditRecordInput): Promise<string> {
    const id = `a-${input.eventId}`;
    this.created.push(input);
    this.rows.set(input.eventId, makeRow({ id, ...input }));
    return id;
  }
}

function envelope(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    eventId: "11111111-1111-1111-1111-111111111111",
    eventType: "morpheo.assessment.completed.v1",
    occurredAt: "2026-08-20T12:00:00Z",
    producer: "morpheo-service",
    correlationId: "corr-1",
    actor: { type: "user", id: "u1" },
    subject: { type: "assessment", id: "a1" },
    data: { routes: ["INS"] },
    ...over,
  };
}

describe("AuditService", () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
  });

  it("normalizes an envelope into an audit record", async () => {
    const result = await new AuditService(store).record(envelope());

    expect(result.outcome).toBe("recorded");
    expect(store.created).toHaveLength(1);
    const record = store.created[0];
    expect(record?.eventType).toBe("morpheo.assessment.completed.v1");
    expect(record?.actorType).toBe("user");
    expect(record?.actorId).toBe("u1");
    expect(record?.subjectId).toBe("a1");
    expect(record?.data).toEqual({ routes: ["INS"] });
  });

  it("carries a null actor through when the envelope has none", async () => {
    await new AuditService(store).record(envelope({ actor: undefined }));
    expect(store.created[0]?.actorType).toBeNull();
    expect(store.created[0]?.actorId).toBeNull();
  });

  it("is idempotent: the same event id is recorded once", async () => {
    store.rows.set("11111111-1111-1111-1111-111111111111", makeRow({ id: "existing" }));

    const result = await new AuditService(store).record(envelope());

    expect(result.outcome).toBe("deduped");
    expect(result.id).toBe("existing");
    expect(store.created).toHaveLength(0);
  });
});
