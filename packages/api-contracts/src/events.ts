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
  // Two or more lowercase dotted segments, then an explicit version. Three is
  // the common shape (`morpheo.assessment.completed.v1`), but §17's own initial
  // list also contains four-segment names such as
  // `identity.organization.invitation.created.v1` and
  // `identity.professional.verification.requested.v1` -- an exactly-three-segment
  // pattern rejected two of the events the build plan itself defines, which went
  // unnoticed while nothing emitted them.
  eventType: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\.v\d+$/, {
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

/**
 * Added in Phase 14 (Addendum A). Kept separate from the §17 list above so that
 * list stays verbatim what the build plan prints, and every later addition is
 * visible as an addition. `identity.organization.invitation.created.v1` and
 * `identity.professional.verification.requested.v1` are already in the §17 list;
 * Checkpoint 14.3 is where they started actually being emitted.
 */
const PHASE_14_EVENT_TYPES: ReadonlyArray<string> = [
  "identity.registration.started.v1",
  "identity.registration.completed.v1",
  "identity.professional.verification.decided.v1",
  "identity.organization.invitation.previewed.v1",
  "identity.organization.invitation.accepted.v1",
  "identity.organization.invitation.expired.v1",
];

/**
 * Added in Phase 15 (Addendum A §A2.1): "every admin action emits an audit
 * event (`admin.<entity>.<action>.v1`)". Two producers appear here on purpose --
 * edge-api records that an admin called a route, identity records the domain
 * change itself. A console role assignment therefore produces both; a bootstrap
 * grant produces only the second, because no route was called.
 */
const PHASE_15_EVENT_TYPES: ReadonlyArray<string> = [
  "admin.session.opened.v1",
  "admin.internal_role.assigned.v1",
  "admin.professional_verification.decided.v1",
  // One per /admin/v1 route (§A2.1: "there is no admin action without an audit
  // record"). Reads are recorded too: who looked at whose account is exactly
  // what an audit of an internal console needs to be able to answer.
  "admin.user.searched.v1",
  "admin.user.viewed.v1",
  "admin.account_status.changed.v1",
  "admin.deletion_request.listed.v1",
  "admin.deletion_request.decided.v1",
  "admin.organization.listed.v1",
  "admin.organization.created.v1",
  "admin.organization_status.changed.v1",
  "admin.organization_members.viewed.v1",
  "admin.verification_queue.viewed.v1",
  "admin.verification_case.decided.v1",
  "admin.internal_role.granted.v1",
  // Checkpoints 15.3 and 15.4. Registered late: the routes emitted these from
  // the day they were built, but the registry is what tells a later reader which
  // event types exist, and a list that is missing entries is worse than no list.
  "admin.content_review_queue.viewed.v1",
  "admin.content_review_item.decided.v1",
  "admin.statistics.viewed.v1",
  "admin.audit_log.viewed.v1",
  "admin.audit_log.exported.v1",
  // Checkpoint 15.5. The one admin action that reaches an individual's clinical
  // data, and the reason §A2.3 exists.
  "admin.break_glass.accessed.v1",
];

const ALL_EVENT_TYPES: ReadonlyArray<string> = [
  ...INITIAL_EVENT_TYPES,
  ...PHASE_14_EVENT_TYPES,
  ...PHASE_15_EVENT_TYPES,
];

export function isKnownEventType(value: string): value is EventType {
  return ALL_EVENT_TYPES.includes(value);
}

export const KNOWN_EVENT_TYPES: ReadonlyArray<EventType> = Object.freeze(
  ALL_EVENT_TYPES as ReadonlyArray<EventType>,
);

export function isProducer(value: string): value is ProducerName {
  return (PRODUCERS as ReadonlyArray<string>).includes(value);
}
