import type { EventEnvelope } from "@somnus/api-contracts";
import { createLogger, type Logger } from "@somnus/observability";
import type { EventPublisher } from "./event-publisher.js";

/**
 * The interim EventPublisher (see the port's header for why): structured-logs
 * the full envelope through the same redaction pipeline every other log line in
 * this service goes through, tagged so it is easy to grep or alert on until a
 * Pub/Sub adapter replaces it.
 *
 * The envelope carries no PII by construction -- the analytics payloads are
 * `.strict()` contracts holding a role branch or an opaque id (see
 * `packages/api-contracts/src/analytics`) -- so logging it is safe.
 */
export class LoggingEventPublisher implements EventPublisher {
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger({
      service: {
        name: "somnus-identity-service",
        env: process.env["NODE_ENV"] ?? "development",
        version: process.env["SERVICE_VERSION"] ?? "0.0.0",
        commit: process.env["SERVICE_COMMIT"] ?? "local",
      },
      correlationId: "event-publisher",
    });
  }

  async publish(event: EventEnvelope): Promise<void> {
    this.logger.info(`event published: ${event.eventType}`, { event });
  }
}
