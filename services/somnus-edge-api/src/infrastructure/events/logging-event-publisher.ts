import type { EventEnvelope } from "@somnus/api-contracts";
import { createLogger, type Logger } from "@somnus/observability";
import type { EventPublisher } from "./event-publisher.js";

/**
 * The interim EventPublisher (see the port's header for why): structured-logs
 * the envelope through the same redaction pipeline as every other log line in
 * this service, tagged so it is easy to grep or alert on until a Pub/Sub
 * adapter replaces it.
 *
 * Admin audit envelopes carry the acting admin's opaque user id and the route's
 * entity/action, never a request body, never a subject's data.
 */
export class LoggingEventPublisher implements EventPublisher {
  private readonly logger: Logger;

  constructor() {
    this.logger = createLogger({
      service: {
        name: "somnus-edge-api",
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
