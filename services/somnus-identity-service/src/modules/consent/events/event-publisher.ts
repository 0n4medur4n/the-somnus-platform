import type { EventEnvelope } from "@somnus/api-contracts";

/**
 * Port: the only thing consent's domain code depends on to emit
 * `consent.receipt.recorded.v1` / `consent.receipt.withdrawn.v1`.
 *
 * No real Pub/Sub topic exists anywhere in this platform yet
 * (infrastructure/terraform/modules/pubsub-topic is scaffolded but
 * never instantiated) -- building one now would be future-phase work
 * the build plan explicitly forbids. `LoggingEventPublisher` is the
 * interim adapter: it gets the event *shape* and the call sites
 * correct today, and swaps for a real Pub/Sub-backed adapter later
 * without any domain code (ConsentService) changing.
 */
export type EventPublisher = {
  publish(event: EventEnvelope): Promise<void>;
};

export const EVENT_PUBLISHER = Symbol("EVENT_PUBLISHER");
