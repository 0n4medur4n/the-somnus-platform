import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { StaffInvitationController } from "./staff-invitation.controller.js";
import { StaffInvitationService } from "./staff-invitation.service.js";
import { StaffInvitationEmailService } from "./staff-invitation-email.service.js";

/**
 * Staff invitations, invitee side. The email sender is exported for the admin
 * routes that create invitations (FirebaseService and the queue are global).
 */
@Module({
  imports: [SessionsModule],
  controllers: [StaffInvitationController],
  providers: [StaffInvitationService, StaffInvitationEmailService],
  exports: [StaffInvitationEmailService],
})
export class StaffInvitationModule {}
