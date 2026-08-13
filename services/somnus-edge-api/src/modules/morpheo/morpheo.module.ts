import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { AssessmentsController } from "./assessments.controller.js";
import { MorpheoProxyService } from "./morpheo.service.js";

/**
 * Morpheo proxy (build plan §20 Checkpoint 10.3). Imports SessionsModule for
 * `SessionGuard` and `ActorResolver` (claim/snapshot); the morpheo client
 * comes from the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [AssessmentsController],
  providers: [MorpheoProxyService],
})
export class MorpheoModule {}
