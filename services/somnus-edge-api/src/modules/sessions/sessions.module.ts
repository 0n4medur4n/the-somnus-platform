import { Module } from "@nestjs/common";
import { SessionGuard } from "./session.guard.js";
import { SessionService } from "./session.service.js";
import { SessionsController } from "./sessions.controller.js";

@Module({
  controllers: [SessionsController],
  providers: [SessionService, SessionGuard],
  exports: [SessionService, SessionGuard],
})
export class SessionsModule {}
