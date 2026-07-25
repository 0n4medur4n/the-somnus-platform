import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ConsentProxyService } from "./consent.service.js";
import { ConsentsController } from "./consents.controller.js";
import { LegalDocumentsController } from "./legal-documents.controller.js";

/**
 * Consent proxy (build plan §20 Checkpoint 8.2). Imports SessionsModule
 * for `SessionGuard` and `ActorResolver`; the identity client comes
 * from the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [LegalDocumentsController, ConsentsController],
  providers: [ConsentProxyService],
})
export class ConsentModule {}
