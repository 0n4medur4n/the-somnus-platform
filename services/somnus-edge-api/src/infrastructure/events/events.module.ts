import { Global, Module } from "@nestjs/common";
import { EDGE_EVENT_PUBLISHER } from "./event-publisher.js";
import { LoggingEventPublisher } from "./logging-event-publisher.js";

/** Global: the admin audit interceptor injects the publisher wherever it runs. */
@Global()
@Module({
  providers: [{ provide: EDGE_EVENT_PUBLISHER, useClass: LoggingEventPublisher }],
  exports: [EDGE_EVENT_PUBLISHER],
})
export class EventsModule {}
