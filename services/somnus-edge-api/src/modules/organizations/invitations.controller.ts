import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Invitation, InvitationPreviewResponse } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { InvitationAcceptDto, InvitationPreviewDto } from "./organizations.dto.js";
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

/**
 * The pre-login half of the invitation flow (Addendum A Checkpoint 14.2).
 *
 * Deliberately NOT session-guarded: Nox has no public signup, so the only way
 * an invited person can be told "this organization invited you" -- or "this
 * invitation has expired" -- is before they have a session. Sending a magic
 * link for an invitation that is already dead, and only failing afterwards,
 * is exactly the fallback-to-open-registration the checkpoint forbids.
 *
 * It is a read: it creates nothing, and it carries no session cookie, so it is
 * CSRF-exempt for the same reason `POST /v1/sessions` and the anonymous
 * assessment routes are (bootstrap/harden.ts). The token is the capability,
 * and it was mailed to the invited address.
 */
@ApiTags("organizations")
@Controller({ path: "v1/invitations" })
export class InvitationPreviewController {
  constructor(private readonly organizations: OrganizationsProxyService) {}

  @Post("preview")
  @HttpCode(200)
  @ApiOperation({ summary: "Look up an invitation by token, before signing in." })
  async preview(
    @Body() body: InvitationPreviewDto,
    @CorrelationId() correlationId?: string,
  ): Promise<InvitationPreviewResponse> {
    return this.organizations.previewInvitation(body, correlationId);
  }
}
