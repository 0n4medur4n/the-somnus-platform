import type { EventEnvelope } from "@somnus/api-contracts";

/**
 * Port: the only thing identity's domain code depends on to emit §17 events.
 *
 * The Consent module has its own publisher under `src/modules/consent/events/`
 * and it stays there: that module is isolated (ADR 0010), and nothing outside it
 * may import its internals. This is the service-level publisher for everything
 * else identity emits -- registration, verification and invitation events
 * (Addendum A Checkpoint 14.3).
 *
 * There is still no real Pub/Sub topic in this platform (the Terraform module is
 * scaffolded but never instantiated -- production-readiness gap #3), so
 * `LoggingEventPublisher` is the interim adapter, exactly as it is for consent:
 * it gets the event shape and the call sites right today and swaps for a
 * Pub/Sub-backed adapter later without a single domain-code change.
 */
export type EventPublisher = {
  publish(event: EventEnvelope): Promise<void>;
};

export const IDENTITY_EVENT_PUBLISHER = Symbol("IDENTITY_EVENT_PUBLISHER");
