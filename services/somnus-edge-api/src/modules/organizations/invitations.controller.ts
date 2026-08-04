import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Invitation } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { InvitationAcceptDto } from "./organizations.dto.js";
import { OrganizationsProxyService } from "./organizations.service.js";

/**
 * Accept an organization invitation by its single-use token. Separate
 * controller because the route lives under `/v1/invitations`, not under
 * a specific organization. Session-guarded and CSRF-protected.
 */
@ApiTags("organizations")
@Controller({ path: "v1/invitations" })
@UseGuards(SessionGuard)
export class InvitationsController {
  constructor(private readonly organizations: OrganizationsProxyService) {}

  @Post("accept")
  @HttpCode(201)
  @ApiOperation({ summary: "Accept an organization invitation by token." })
  async accept(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: InvitationAcceptDto,
    @CorrelationId() correlationId?: string,
  ): Promise<Invitation> {
    return this.organizations.acceptInvitation(session, body, correlationId);
  }
}
