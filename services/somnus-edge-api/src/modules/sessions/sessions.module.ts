import { Module } from "@nestjs/common";
import { ActorResolver } from "./actor-resolver.service.js";
import { OptionalSessionGuard } from "./optional-session.guard.js";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";
import { SessionsController } from "./sessions.controller.js";

@Module({
  controllers: [SessionsController],
  providers: [SessionService, SessionGuard, OptionalSessionGuard, ActorResolver],
  exports: [SessionService, SessionGuard, OptionalSessionGuard, ActorResolver],
})
export class SessionsModule {}
