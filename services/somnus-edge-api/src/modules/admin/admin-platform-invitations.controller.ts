import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  PlatformInvitationCreateRequestSchema,
  PlatformInvitationListResponseSchema,
  PlatformInvitationSchema,
} from "@somnus/api-contracts";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { PlatformInvitationEmailService } from "../platform-invitation/platform-invitation-email.service.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AdminProxyService } from "./admin.service.js";
import { AdminAuditInterceptor, type RequestWithAuditDetail } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminRoute } from "./admin-route.decorator.js";

class CreateDto extends createZodDto(PlatformInvitationCreateRequestSchema) {}

@ApiTags("admin")
@Controller("admin/v1/platform-invitations")
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminPlatformInvitationsController {
  constructor(
    private readonly admin: AdminProxyService,
    private readonly email: PlatformInvitationEmailService,
  ) {}
  @Get()
  @AdminRoute({
    capability: "admin_users_invite",
    eventType: "admin.platform_invitation.listed.v1",
    entity: "platform_invitation",
  })
  list(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ) {
    return this.admin.forward({
      method: "GET",
      path: "/internal/v1/admin/platform-invitations",
      actorId: session?.somnusUserId ?? "",
      correlationId: correlationOf(correlationId),
      schema: PlatformInvitationListResponseSchema,
    });
  }
  @Post()
  @AdminRoute({
    capability: "admin_users_invite",
    eventType: "admin.platform_invitation.created.v1",
    entity: "platform_invitation",
  })
  async create(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: CreateDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() rawCorrelationId?: string,
  ) {
    const correlationId = correlationOf(rawCorrelationId);
    const invitation = await this.admin.forward({
      method: "POST",
      path: "/internal/v1/admin/platform-invitations",
      actorId: session?.somnusUserId ?? "",
      correlationId,
      schema: PlatformInvitationSchema,
      body,
    });
    request.adminAuditDetail = { subjectId: invitation.id, data: { invitationId: invitation.id } };
    return { invitation, emailQueued: await this.email.send(invitation, correlationId) };
  }
  @Post(":invitationId/revoke")
  @HttpCode(204)
  @AdminRoute({
    capability: "admin_users_invite",
    eventType: "admin.platform_invitation.revoked.v1",
    entity: "platform_invitation",
  })
  async revoke(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("invitationId") id: string,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ) {
    await this.admin.forward({
      method: "POST",
      path: `/internal/v1/admin/platform-invitations/${encodeURIComponent(id)}/revoke`,
      actorId: session?.somnusUserId ?? "",
      correlationId: correlationOf(correlationId),
      schema: z.unknown().transform(() => undefined),
    });
    request.adminAuditDetail = { subjectId: id, data: { invitationId: id } };
  }
}
