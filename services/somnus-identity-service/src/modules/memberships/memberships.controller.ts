import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Membership } from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import { MembershipPatchDto } from "../../common/dto/identity.dto.js";
import { MembershipsService } from "./memberships.service.js";

@ApiTags("memberships")
@Controller({ path: "v1/organizations/:organizationId/members" })
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Get()
  @ApiOperation({ summary: "List an organization's members. Requires active membership." })
  async list(
    @CurrentActorId() actorId: string,
    @Param("organizationId") organizationId: string,
  ): Promise<Membership[]> {
    return this.membershipsService.list(actorId, organizationId);
  }

  @Patch(":membershipId")
  @ApiOperation({ summary: "Patch a member's status. Requires an active admin/owner membership." })
  async patch(
    @CurrentActorId() actorId: string,
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: MembershipPatchDto,
  ): Promise<Membership> {
    return this.membershipsService.patch(actorId, organizationId, membershipId, body);
  }
}
