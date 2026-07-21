import { z } from "zod";
import { opaqueId } from "./uuid.js";

/**
 * §17 versioned event envelope. Every event crossing a service
 * boundary uses this shape; producers and consumers agree on the
 * eventType string.
 *
 * Never include passwords, tokens, cookies, full report bodies,
 * unrestricted free text, or full answer collections.
 */
export const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.v\d+$/, {
      message:
        "eventType must look like 'service.entity.action.vN', e.g. 'morpheo.assessment.completed.v1'",
    }),
  occurredAt: z.string().datetime(),
  producer: z.string().min(1),
  correlationId: z.string().min(1).max(64),
  actor: z
    .object({
      type: z.string().min(1),
      id: z.string().min(1),
    })
    .optional(),
  subject: z.object({
    type: z.string().min(1),
    id: z.string().min(1),
  }),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type EventType = EventEnvelope["eventType"];

const PRODUCERS = [
  "somnus-identity-service",
  "somnus-edge-api",
  "morpheo-service",
  "somnus-report-service",
  "somnus-worker",
] as const;

export type ProducerName = (typeof PRODUCERS)[number];

const INITIAL_EVENT_TYPES: ReadonlyArray<string> = [
  "identity.user.created.v1",
  "identity.organization.created.v1",
  "identity.organization.invitation.created.v1",
  "identity.professional.verification.requested.v1",
  "consent.receipt.recorded.v1",
  "consent.receipt.withdrawn.v1",
  "morpheo.assessment.created.v1",
  "morpheo.assessment.completed.v1",
  "report.generation.requested.v1",
  "report.generated.v1",
  "notification.email.requested.v1",
];

/**
 * Build an event envelope with a freshly generated eventId. The
 * `data` field is intentionally typed as `Record<string, unknown>`;
 * a downstream consumer should narrow it with a domain-specific Zod
 * schema.
 */
export function makeEvent<T extends Record<string, unknown>>(args: {
  eventType: EventType;
  producer: ProducerName;
  correlationId: string;
  subject: { type: string; id: string };
  actor?: { type: string; id: string };
  data: T;
  occurredAt?: string;
}): EventEnvelope {
  return {
    eventId: opaqueId(),
    eventType: args.eventType,
    occurredAt: args.occurredAt ?? new Date().toISOString(),
    producer: args.producer,
    correlationId: args.correlationId,
    ...(args.actor ? { actor: args.actor } : {}),
    subject: args.subject,
    data: { ...args.data },
  };
}

export function isKnownEventType(value: string): value is EventType {
  return INITIAL_EVENT_TYPES.includes(value);
}

export const KNOWN_EVENT_TYPES: ReadonlyArray<EventType> = Object.freeze(
  INITIAL_EVENT_TYPES as ReadonlyArray<EventType>,
);

export function isProducer(value: string): value is ProducerName {
  return (PRODUCERS as ReadonlyArray<string>).includes(value);
}
