import type { EventEnvelope } from "@somnus/api-contracts";
import { createLogger, type Logger } from "@somnus/observability";
import type { EventPublisher } from "./event-publisher.js";

/**
 * The current, interim implementation of EventPublisher (see that
 * file's header comment for why): structured-logs the full envelope
 * through the same redaction pipeline every other log line in this
 * service goes through, tagged so it's easy to grep/alert on until a
 * real Pub/Sub adapter replaces it.
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
