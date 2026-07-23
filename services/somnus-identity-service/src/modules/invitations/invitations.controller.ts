import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Invitation, InvitationCreateResponse } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
// biome-ignore lint/style/useImportType: used as @Body() parameter types -- nestjs-zod's global ZodValidationPipe needs a real import to recognize and validate these DTO classes at runtime.
import { InvitationAcceptDto, InvitationCreateDto } from "../../common/dto/identity.dto.js";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve this as a DI token; a type-only import erases the reference and breaks injection.
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
