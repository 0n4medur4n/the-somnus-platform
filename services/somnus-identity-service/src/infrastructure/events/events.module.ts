import { Global, Module } from "@nestjs/common";
import { IDENTITY_EVENT_PUBLISHER } from "./event-publisher.js";
import { LoggingEventPublisher } from "./logging-event-publisher.js";

/**
 * Global, like `DbModule`: any identity module may emit a §17 event without
 * wiring a provider of its own. The Consent module does NOT use this one -- it
 * keeps its own publisher inside its isolation boundary (ADR 0010).
 */
@Global()
@Module({
  providers: [{ provide: IDENTITY_EVENT_PUBLISHER, useClass: LoggingEventPublisher }],
  exports: [IDENTITY_EVENT_PUBLISHER],
})
export class EventsModule {}
