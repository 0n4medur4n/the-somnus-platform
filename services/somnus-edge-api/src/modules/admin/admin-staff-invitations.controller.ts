import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type StaffInvitation,
  type StaffInvitationCreateRequest,
  StaffInvitationCreateRequestSchema,
  type StaffInvitationCreateResponse,
  type StaffInvitationListResponse,
  StaffInvitationListResponseSchema,
  StaffInvitationSchema,
} from "@somnus/api-contracts";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { StaffInvitationEmailService } from "../staff-invitation/staff-invitation-email.service.js";
import { AdminProxyService } from "./admin.service.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminRoute } from "./admin-route.decorator.js";

/**
 * Inviting staff from the console (owner decision 2026-10-18). An invitation
 * grants an internal role once accepted, so it carries the same capability as
 * granting one directly: `admin_roles_assign`.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminStaffInvitationsController {
  constructor(
    private readonly admin: AdminProxyService,
    private readonly email: StaffInvitationEmailService,
  ) {}

  private actor(session: SessionRecord | undefined): string {
    // The guard resolved and approved the actor before this handler ran.
    return session?.somnusUserId ?? "";
  }

  @Get("staff-invitations")
  @AdminRoute({
    capability: "admin_roles_assign",
    eventType: "admin.staff_invitation.listed.v1",
    entity: "staff_invitation",
  })
  @ApiOperation({ summary: "Recent staff invitations, newest first." })
  async list(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<StaffInvitationListResponse> {
    return this.admin.forward({
      method: "GET",
      path: "/internal/v1/admin/staff-invitations",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: StaffInvitationListResponseSchema,
    });
  }

  @Post("staff-invitations")
  @HttpCode(201)
  @AdminRoute({
    capability: "admin_roles_assign",
    eventType: "admin.staff_invitation.created.v1",
    entity: "staff_invitation",
  })
  @ApiOperation({
    summary: "Invite a member of staff (name, address, internal role) and email them.",
  })
  async create(
    @CurrentSession() session: SessionRecord | undefined,
    @Body(new ZodValidationPipe(StaffInvitationCreateRequestSchema))
    body: StaffInvitationCreateRequest,
    @CorrelationId() rawCorrelationId?: string,
  ): Promise<StaffInvitationCreateResponse> {
    const correlationId = correlationOf(rawCorrelationId);
    const invitation = await this.admin.forward({
      method: "POST",
      path: "/internal/v1/admin/staff-invitations",
      actorId: this.actor(session),
      correlationId,
      schema: StaffInvitationSchema,
      body,
    });
    const emailSent = await this.email.send(invitation, correlationId);
    return { invitation, emailSent };
  }

  @Post("staff-invitations/:invitationId/revoke")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_roles_assign",
    eventType: "admin.staff_invitation.revoked.v1",
    entity: "staff_invitation",
  })
  @ApiOperation({ summary: "Withdraw a pending staff invitation." })
  async revoke(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("invitationId") invitationId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<StaffInvitation> {
    return this.admin.forward({
      method: "POST",
      path: `/internal/v1/admin/staff-invitations/${encodeURIComponent(invitationId)}/revoke`,
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: StaffInvitationSchema,
    });
  }
}
