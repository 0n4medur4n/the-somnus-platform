import { Module } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import {
  InvitationsController,
  OrganizationInvitationsController,
} from "./invitations.controller.js";
import { InvitationsService } from "./invitations.service.js";

@Module({
  imports: [AuthorizationModule],
  controllers: [OrganizationInvitationsController, InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
