import { Module } from "@nestjs/common";
import { ActorResolver } from "./actor-resolver.service.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";
import { SessionsController } from "./sessions.controller.js";

@Module({
  controllers: [SessionsController],
  providers: [SessionService, SessionGuard, ActorResolver],
  exports: [SessionService, SessionGuard, ActorResolver],
})
export class SessionsModule {}
