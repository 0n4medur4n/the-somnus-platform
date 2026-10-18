import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module.js";
import { ConsentModule } from "../consent/consent.module.js";
import {
  AdminStaffInvitationsController,
  StaffInvitationsController,
} from "./staff-invitations.controller.js";
import { StaffInvitationsService } from "./staff-invitations.service.js";

/**
 * Staff invitations (owner decision 2026-10-18). `AdminModule` for
 * `InternalRolesService` -- the one path that grants an internal role -- and
 * `ConsentModule` for the privacy acknowledgement receipt, through its public
 * interface only. Repositories come from the global DbModule.
 */
@Module({
  imports: [AdminModule, ConsentModule],
  controllers: [AdminStaffInvitationsController, StaffInvitationsController],
  providers: [StaffInvitationsService],
})
export class StaffInvitationsModule {}
