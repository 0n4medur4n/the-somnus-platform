import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import type {
  AuditRecordInput,
  AuditRow,
  AuditStore,
} from "../src/modules/audit/db/repositories/index.js";
import { AuditRepository } from "../src/modules/audit/db/repositories/index.js";

class FakeStore implements AuditStore {
  seen = new Set<string>();
  async findByEventId(eventId: string): Promise<AuditRow | null> {
    if (!this.seen.has(eventId)) return null;
    return {
      id: `a-${eventId}`,
      eventId,
      eventType: "x.y.z.v1",
      occurredAt: "2026-08-20T12:00:00Z",
      producer: "morpheo-service",
      correlationId: "c",
      actorType: null,
      actorId: null,
      subjectType: "assessment",
      subjectId: "s",
      data: {},
      receivedAt: new Date(),
    };
  }
  async create(input: AuditRecordInput): Promise<string> {
    this.seen.add(input.eventId);
    return `a-${input.eventId}`;
  }
}

const ENVELOPE = {
  eventId: "22222222-2222-4222-8222-222222222222",
  eventType: "morpheo.assessment.completed.v1",
  occurredAt: "2026-08-20T12:00:00Z",
  producer: "morpheo-service",
  correlationId: "corr-1",
  subject: { type: "assessment", id: "a1" },
  data: {},
};

describe("audit ingest (e2e)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuditRepository)
      .useValue(new FakeStore())
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("records an event, and dedupes a redelivery of the same event id", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/internal/v1/audit/events",
      payload: ENVELOPE,
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ outcome: "recorded" });

    const second = await app.inject({
      method: "POST",
      url: "/internal/v1/audit/events",
      payload: ENVELOPE,
    });
    expect(second.json()).toEqual({ outcome: "deduped" });
  });

  it("rejects a malformed event type (400 VALIDATION_FAILED)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/v1/audit/events",
      payload: { ...ENVELOPE, eventType: "NotAValidType" },
    });
    expect(response.statusCode).toBe(400);
  });
});
