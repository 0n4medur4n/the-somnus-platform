import { Module } from "@nestjs/common";
import { ConsentService } from "./consent.service.js";
import { ConsentCheckController } from "./consent-check.controller.js";
import { ConsentsController } from "./consents.controller.js";
import { ConsentDbModule } from "./db/consent-db.module.js";
import { EVENT_PUBLISHER } from "./events/event-publisher.js";
import { LoggingEventPublisher } from "./events/logging-event-publisher.js";
import { LegalDocumentsController } from "./legal-documents.controller.js";

/**
 * Build plan §13 / ADR 0010: fully isolated. Only `ConsentService` is
 * exported -- nothing outside this module can reach `ConsentDbModule`,
 * its repositories, or the event publisher directly. Enforced twice:
 * this module simply never exports them, and
 * `.dependency-cruiser.cjs` fails the build if any file outside
 * `src/modules/consent/` imports anything from this folder except
 * `consent.service.js`.
 */
@Module({
  imports: [ConsentDbModule],
  controllers: [LegalDocumentsController, ConsentsController, ConsentCheckController],
  providers: [ConsentService, { provide: EVENT_PUBLISHER, useClass: LoggingEventPublisher }],
  exports: [ConsentService],
})
export class ConsentModule {}
