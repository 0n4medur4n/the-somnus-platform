import type { EventEnvelope } from "@somnus/api-contracts";

/**
 * Port: the only thing edge-api depends on to emit a §17 event.
 *
 * Addendum A §A2.1 requires every admin action to emit an audit event consumed
 * by the worker's Audit module. That module's ingest endpoint is documented as
 * a **Pub/Sub push target**, and no Pub/Sub topic exists yet
 * (production-readiness gap #3). Calling the worker over HTTP instead would
 * invent a transport the build plan does not describe and add an edge -> worker
 * dependency the deployable map does not have.
 *
 * So this follows the pattern the platform already chose twice (consent, then
 * identity in Checkpoint 14.3): the port fixes the event shape and the call
 * sites now, and `LoggingEventPublisher` is swapped for a Pub/Sub adapter when
 * gap #3 closes -- with no controller, guard or interceptor changing.
 */
export type EventPublisher = {
  publish(event: EventEnvelope): Promise<void>;
};

export const EDGE_EVENT_PUBLISHER = Symbol("EDGE_EVENT_PUBLISHER");
