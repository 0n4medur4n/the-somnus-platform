import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { InvitationsController } from "./invitations.controller.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsProxyService } from "./organizations.service.js";

/**
 * Organization + invitation proxy (build plan §20 Checkpoint 9.1),
 * enabling the SPA golden path. Imports SessionsModule for
 * `SessionGuard` and `ActorResolver`; the identity client comes from
 * the global InternalClientsModule.
 */
@Module({
  imports: [SessionsModule],
  controllers: [OrganizationsController, InvitationsController],
  providers: [OrganizationsProxyService],
})
export class OrganizationsModule {}
