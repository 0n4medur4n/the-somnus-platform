import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type StaffInvitationAcceptRequest,
  StaffInvitationAcceptRequestSchema,
  type StaffInvitationPendingResponse,
} from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { StaffInvitationService } from "./staff-invitation.service.js";

/**
 * A staff invitation, seen by the person it was sent to (owner decision
 * 2026-10-18). Session-guarded; the accept is CSRF-protected by the global
 * preHandler like every state-changing route. Deliberately NOT under
 * `/admin/v1`: the person holds no internal role until they accept.
 */
@ApiTags("staff-invitation")
@Controller({ path: "v1/staff-invitation" })
@UseGuards(SessionGuard)
export class StaffInvitationController {
  constructor(private readonly invitations: StaffInvitationService) {}

  @Get()
  @ApiOperation({ summary: "What the signed-in address was invited as, if anything." })
  async pending(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<StaffInvitationPendingResponse> {
    return this.invitations.pending(session, correlationId);
  }

  @Post("accept")
  @HttpCode(204)
  @ApiOperation({ summary: "Accept the invitation: acknowledge the privacy policy and join." })
  async accept(
    @CurrentSession() session: SessionRecord | undefined,
    @Body(new ZodValidationPipe(StaffInvitationAcceptRequestSchema))
    _body: StaffInvitationAcceptRequest,
    @CorrelationId() correlationId?: string,
  ): Promise<void> {
    await this.invitations.accept(session, correlationId);
  }
}
