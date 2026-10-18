import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type {
  StaffInvitation,
  StaffInvitationListResponse,
  StaffInvitationPendingResponse,
  UserResolveResponse,
  UUIDv7,
} from "@somnus/api-contracts";
import { CurrentActorId } from "../../common/decorators/current-actor.decorator.js";
import {
  StaffInvitationAcceptDto,
  StaffInvitationCreateDto,
  StaffInvitationLookupDto,
} from "./staff-invitations.dto.js";
import { StaffInvitationsService } from "./staff-invitations.service.js";

/**
 * The console's side of staff invitations. Like every identity admin route, the
 * capability (`admin_roles_assign`) was decided at the edge before forwarding;
 * the invariants that hold for every caller live in the service.
 */
@ApiTags("admin")
@Controller({ path: "internal/v1/admin/staff-invitations" })
export class AdminStaffInvitationsController {
  constructor(private readonly invitations: StaffInvitationsService) {}

  @Get()
  @ApiOperation({ summary: "Recent staff invitations, newest first." })
  async list(): Promise<StaffInvitationListResponse> {
    return this.invitations.list();
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Invite a member of staff with an internal role." })
  async create(
    @CurrentActorId() actorId: string,
    @Body() body: StaffInvitationCreateDto,
  ): Promise<StaffInvitation> {
    return this.invitations.create(actorId as UUIDv7, body, `staff-invitation-${actorId}`);
  }

  @Post(":invitationId/revoke")
  @HttpCode(200)
  @ApiOperation({ summary: "Withdraw a pending staff invitation." })
  async revoke(@Param("invitationId") invitationId: string): Promise<StaffInvitation> {
    return this.invitations.revoke(invitationId, `staff-invitation-revoke-${invitationId}`);
  }
}

/**
 * The invited person's side. Edge calls these with the address and identity
 * the SESSION verified; nothing here trusts an address a client typed.
 */
@ApiTags("staff-invitations")
@Controller({ path: "internal/v1/staff-invitations" })
export class StaffInvitationsController {
  constructor(private readonly invitations: StaffInvitationsService) {}

  @Post("pending")
  @HttpCode(200)
  @ApiOperation({ summary: "The usable invitation for a verified address, if any." })
  async pending(@Body() body: StaffInvitationLookupDto): Promise<StaffInvitationPendingResponse> {
    return this.invitations.pending(body.email);
  }

  @Post("accept")
  @HttpCode(200)
  @ApiOperation({ summary: "Accept: create (or reuse) the account and grant the role." })
  async accept(@Body() body: StaffInvitationAcceptDto): Promise<UserResolveResponse> {
    return this.invitations.accept(body, `staff-invitation-accept-${body.providerUserId}`);
  }
}
