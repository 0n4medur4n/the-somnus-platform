import { describe, expect, it } from "vitest";
import {
  EventEnvelopeSchema,
  isKnownEventType,
  isProducer,
  KNOWN_EVENT_TYPES,
  makeEvent,
} from "./events.js";

describe("EventEnvelopeSchema", () => {
  it("accepts a well-formed envelope", () => {
    const env = makeEvent({
      eventType: "morpheo.assessment.completed.v1",
      producer: "morpheo-service",
      correlationId: "corr-1",
      subject: { type: "assessment", id: "0193f3a4-7c00-7c00-a000-000000000001" },
      actor: { type: "user", id: "0193f3a4-7c00-7c00-a000-000000000002" },
      data: { foo: "bar" },
    });
    const r = EventEnvelopeSchema.safeParse(env);
    expect(r.success).toBe(true);
  });

  it("rejects an eventType that does not match the §17 format", () => {
    const r = EventEnvelopeSchema.safeParse({
      eventId: "0193f3a4-7c00-7c00-a000-000000000001",
      eventType: "Morpheo-Assessment-Completed",
      occurredAt: new Date().toISOString(),
      producer: "morpheo-service",
      correlationId: "c",
      subject: { type: "assessment", id: "x" },
      data: {},
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-UUIDv4 eventId", () => {
    const r = EventEnvelopeSchema.safeParse({
      eventId: "not-a-uuid",
      eventType: "morpheo.assessment.completed.v1",
      occurredAt: new Date().toISOString(),
      producer: "morpheo-service",
      correlationId: "c",
      subject: { type: "assessment", id: "x" },
      data: {},
    });
    expect(r.success).toBe(false);
  });

  it("requires subject and producer", () => {
    const r = EventEnvelopeSchema.safeParse({
      eventId: "0193f3a4-7c00-7c00-a000-000000000001",
      eventType: "morpheo.assessment.completed.v1",
      occurredAt: new Date().toISOString(),
      correlationId: "c",
      data: {},
    });
    expect(r.success).toBe(false);
  });
});

describe("makeEvent", () => {
  it("generates a fresh eventId and ISO timestamp when omitted", () => {
    const e1 = makeEvent({
      eventType: "morpheo.assessment.created.v1",
      producer: "morpheo-service",
      correlationId: "c",
      subject: { type: "assessment", id: "x" },
      data: {},
    });
    expect(e1.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e1.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(e1.actor).toBeUndefined();
  });

  it("omits actor from the JSON when not provided", () => {
    const e = makeEvent({
      eventType: "morpheo.assessment.created.v1",
      producer: "morpheo-service",
      correlationId: "c",
      subject: { type: "assessment", id: "x" },
      data: {},
    });
    expect("actor" in e).toBe(false);
  });
});

describe("isKnownEventType and isProducer", () => {
  it("recognizes the §17 initial events", () => {
    for (const t of KNOWN_EVENT_TYPES) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });
  it("rejects an unknown event type", () => {
    expect(isKnownEventType("morpheo.assessment.completed.v99")).toBe(false);
  });
  it("recognizes the five services", () => {
    expect(isProducer("morpheo-service")).toBe(true);
    expect(isProducer("somnus-edge-api")).toBe(true);
    expect(isProducer("not-a-service")).toBe(false);
  });
});
