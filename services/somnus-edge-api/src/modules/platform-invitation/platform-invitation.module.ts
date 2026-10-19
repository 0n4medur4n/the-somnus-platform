import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { PlatformInvitationController } from "./platform-invitation.controller.js";
import { PlatformInvitationService } from "./platform-invitation.service.js";
import { PlatformInvitationEmailService } from "./platform-invitation-email.service.js";
@Module({
  imports: [SessionsModule],
  controllers: [PlatformInvitationController],
  providers: [PlatformInvitationService, PlatformInvitationEmailService],
  exports: [PlatformInvitationEmailService],
})
export class PlatformInvitationModule {}
