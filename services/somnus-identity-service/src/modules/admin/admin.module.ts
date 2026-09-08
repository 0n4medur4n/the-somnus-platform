import { Module } from "@nestjs/common";
import { AccountModule } from "../account/account.module.js";
import {
  AdminOrganizationsController,
  AdminRolesController,
  AdminUsersController,
  AdminVerificationController,
} from "./admin.controller.js";
import { AdminOrganizationsService } from "./admin-organizations.service.js";
import { AdminUsersService } from "./admin-users.service.js";
import { AdminVerificationService } from "./admin-verification.service.js";
import { InternalRolesService } from "./internal-roles.service.js";

/**
 * The admin console's server side inside identity (Addendum A Checkpoint 15.2).
 *
 * Authorization for these operations is decided by the capability matrix in
 * `src/domain/authorization/admin-capability-policy.ts` and enforced at the
 * edge; what lives here is the domain logic each capability performs, plus the
 * invariants that hold for every caller. Repositories come from the global
 * DbModule and the event publisher from the global EventsModule.
 *
 * `AccountModule` is imported for the erasure the user's own `DELETE /v1/me`
 * runs -- completing a deletion request must not grow a second erasure path
 * that could drift from it.
 */
@Module({
  imports: [AccountModule],
  controllers: [
    AdminUsersController,
    AdminOrganizationsController,
    AdminVerificationController,
    AdminRolesController,
  ],
  providers: [
    AdminOrganizationsService,
    AdminUsersService,
    AdminVerificationService,
    InternalRolesService,
  ],
  exports: [
    AdminOrganizationsService,
    AdminUsersService,
    AdminVerificationService,
    InternalRolesService,
  ],
})
export class AdminModule {}
