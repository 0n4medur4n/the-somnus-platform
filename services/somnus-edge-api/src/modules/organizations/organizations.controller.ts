import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { InvitationCreateResponse, Membership, Organization } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { InvitationCreateDto, OrganizationCreateDto } from "./organizations.dto.js";
import { OrganizationsProxyService } from "./organizations.service.js";

/**
 * Session-guarded organization surface proxied to identity. The POST
 * routes are CSRF-protected by the global preHandler
 * (bootstrap/harden.ts). No authorization logic here -- identity
 * decides; edge-api only forwards the actor.
 */
@ApiTags("organizations")
@Controller({ path: "v1/organizations" })
@UseGuards(SessionGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsProxyService) {}

  @Post()
  @ApiOperation({ summary: "Create an organization (the actor becomes its owner)." })
  async create(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: OrganizationCreateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<Organization> {
    return this.organizations.create(session, body, correlationId);
  }

  @Get(":organizationId")
  @ApiOperation({ summary: "Get an organization the actor may see." })
  async getById(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("organizationId") organizationId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<Organization> {
    return this.organizations.getById(session, organizationId, correlationId);
  }

  @Get(":organizationId/members")
  @ApiOperation({ summary: "List the members of an organization." })
  async listMembers(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("organizationId") organizationId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<Membership[]> {
    return this.organizations.listMembers(session, organizationId, correlationId);
  }

  @Post(":organizationId/invitations")
  @ApiOperation({ summary: "Invite someone to an organization." })
  async invite(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("organizationId") organizationId: string,
    @Body() body: InvitationCreateDto,
    @CorrelationId() correlationId?: string,
  ): Promise<InvitationCreateResponse> {
    return this.organizations.invite(session, organizationId, body, correlationId);
  }
}
