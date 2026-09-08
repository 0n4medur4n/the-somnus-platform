import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { EventEnvelopeSchema, isKnownEventType, makeEvent } from "../events.js";
import { opaqueId } from "../uuid.js";
import {
  ANALYTICS_EVENT_DATA_SCHEMAS,
  ANALYTICS_EVENT_TYPES,
  type AnalyticsEventType,
  FORBIDDEN_ANALYTICS_FIELDS,
  isAnalyticsEventType,
} from "./funnel-events.js";

/**
 * The redaction guarantee for the BigQuery export (build plan §9 / Addendum A
 * Checkpoint 14.3), asserted at the level of the SCHEMA rather than of any
 * particular event.
 *
 * A test that builds one event and checks it looks clean proves nothing about
 * the next field someone adds. These walk every registered payload contract and
 * assert two structural properties: no declared field is a forbidden one, and no
 * undeclared field can be introduced at runtime because every schema is strict.
 * Together those make "the export cannot contain a name or an email" a property
 * of the contract, not of producer discipline.
 */

/** Recursively collect every field name a schema declares, at any depth. */
function declaredFields(schema: z.ZodTypeAny, seen = new Set<z.ZodTypeAny>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const def = (schema as unknown as { def?: { type?: string; shape?: Record<string, unknown> } })
    .def;
  if (!def) return [];

  if (def.type === "object" && def.shape) {
    return Object.entries(def.shape).flatMap(([key, value]) => [
      key,
      ...declaredFields(value as z.ZodTypeAny, seen),
    ]);
  }
  return [];
}

function normalize(field: string): string {
  return field.toLowerCase().replace(/[_-]/g, "");
}

const NORMALIZED_FORBIDDEN = new Set(FORBIDDEN_ANALYTICS_FIELDS.map(normalize));

/** A minimal valid payload per event type, used to probe strictness. */
const VALID_PAYLOADS: Record<AnalyticsEventType, Record<string, unknown>> = {
  "identity.registration.started.v1": { roleBranch: "adult" },
  "identity.registration.completed.v1": { roleBranch: "professional" },
  "identity.professional.verification.requested.v1": { caseId: opaqueId() },
  "identity.professional.verification.decided.v1": {
    caseId: opaqueId(),
    decision: "approved",
    timeToDecisionMs: 1000,
  },
  "identity.organization.invitation.created.v1": { invitationId: opaqueId() },
  "identity.organization.invitation.previewed.v1": { invitationId: opaqueId() },
  "identity.organization.invitation.accepted.v1": { invitationId: opaqueId() },
  "identity.organization.invitation.expired.v1": {
    invitationId: opaqueId(),
    stage: "preview",
  },
};

describe("analytics payload contracts (schema-level redaction guarantee)", () => {
  it("registers a schema and a sample payload for every analytics event type", () => {
    expect(ANALYTICS_EVENT_TYPES.length).toBeGreaterThan(0);
    for (const eventType of ANALYTICS_EVENT_TYPES) {
      expect(ANALYTICS_EVENT_DATA_SCHEMAS[eventType], eventType).toBeDefined();
      expect(VALID_PAYLOADS[eventType], eventType).toBeDefined();
    }
  });

  it.each(ANALYTICS_EVENT_TYPES)("%s declares no forbidden field", (eventType) => {
    const fields = declaredFields(ANALYTICS_EVENT_DATA_SCHEMAS[eventType]);
    expect(fields.length, `${eventType} declares no fields at all`).toBeGreaterThan(0);

    const offenders = fields.filter((field) => NORMALIZED_FORBIDDEN.has(normalize(field)));
    expect(offenders, `${eventType} must not carry ${offenders.join(", ")}`).toEqual([]);
  });

  it.each(ANALYTICS_EVENT_TYPES)(
    "%s is strict: no undeclared field can be introduced at runtime",
    (eventType) => {
      const schema = ANALYTICS_EVENT_DATA_SCHEMAS[eventType];
      const valid = VALID_PAYLOADS[eventType];
      expect(schema.safeParse(valid).success, `${eventType} rejects its own sample`).toBe(true);

      // Every forbidden field, one at a time, on top of an otherwise valid
      // payload. None may be accepted.
      for (const field of FORBIDDEN_ANALYTICS_FIELDS) {
        const result = schema.safeParse({ ...valid, [field]: "Ada Lovelace" });
        expect(result.success, `${eventType} accepted a "${field}" field`).toBe(false);
      }

      // And an arbitrary field nobody thought to forbid.
      expect(schema.safeParse({ ...valid, somethingNew: "x" }).success).toBe(false);
    },
  );

  it("the forbidden list actually covers the fields §9 names", () => {
    for (const field of ["name", "email", "phone", "answers", "token", "content"]) {
      expect(NORMALIZED_FORBIDDEN.has(normalize(field)), field).toBe(true);
    }
  });
});

describe("analytics events use the §17 envelope", () => {
  it.each(ANALYTICS_EVENT_TYPES)("%s builds a valid envelope", (eventType) => {
    const event = makeEvent({
      eventType,
      producer: "somnus-identity-service",
      correlationId: "corr-1",
      subject: { type: "user", id: opaqueId() },
      data: VALID_PAYLOADS[eventType],
    });

    const parsed = EventEnvelopeSchema.safeParse(event);
    expect(parsed.success, JSON.stringify(parsed.success ? undefined : parsed.error)).toBe(true);
    expect(event.eventType).toBe(eventType);
    expect(event.producer).toBe("somnus-identity-service");
  });

  it.each(ANALYTICS_EVENT_TYPES)("%s is a registered event type", (eventType) => {
    expect(isKnownEventType(eventType), `${eventType} missing from the event registry`).toBe(true);
    expect(isAnalyticsEventType(eventType)).toBe(true);
  });

  it("does not claim unrelated event types as analytics events", () => {
    expect(isAnalyticsEventType("consent.receipt.recorded.v1")).toBe(false);
    expect(isAnalyticsEventType("morpheo.assessment.completed.v1")).toBe(false);
    expect(isAnalyticsEventType("not.an.event.v1")).toBe(false);
  });
});
