import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  Invitation,
  InvitationCreateResponse,
  InvitationPreviewResponse,
} from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import {
  InvitationAcceptDto,
  InvitationCreateDto,
  InvitationPreviewDto,
} from "../../common/dto/identity.dto.js";
import { InvitationsService } from "./invitations.service.js";

@ApiTags("invitations")
@Controller({ path: "v1/organizations/:organizationId/invitations" })
export class OrganizationInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @ApiOperation({
    summary: "Invite a member to the organization. Requires an active admin/owner membership.",
  })
  async create(
    @CurrentActorId() actorId: string,
    @Param("organizationId") organizationId: string,
    @Body() body: InvitationCreateDto,
  ): Promise<InvitationCreateResponse> {
    return this.invitationsService.create(actorId, organizationId, body);
  }
}

@ApiTags("invitations")
@Controller({ path: "v1/invitations" })
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post("accept")
  @ApiOperation({
    summary: "Accept an invitation by its single-use token (build plan §20 Checkpoint 6.3).",
  })
  async accept(
    @CurrentActorId() actorId: string,
    @Body() body: InvitationAcceptDto,
  ): Promise<Invitation> {
    return this.invitationsService.accept(actorId, body.token);
  }
}

/**
 * Internal-only (build plan §16 `/internal/v1/`), and the one invitation route
 * that takes no actor: it backs the pre-login accept screen, where the invited
 * person has no session yet (Addendum A Checkpoint 14.2). The token is the
 * only credential, and it was mailed to the invited address.
 */
@ApiTags("invitations")
@Controller({ path: "internal/v1/invitations" })
export class InvitationPreviewController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post("preview")
  @HttpCode(200)
  @ApiOperation({
    summary: "Look up an invitation by token, before the invited person has a session.",
  })
  async preview(@Body() body: InvitationPreviewDto): Promise<InvitationPreviewResponse> {
    return this.invitationsService.preview(body.token);
  }
}
