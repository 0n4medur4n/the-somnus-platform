import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";

/**
 * Imports SessionsModule for `SessionGuard` and `ActorResolver`; the
 * identity client comes from the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
