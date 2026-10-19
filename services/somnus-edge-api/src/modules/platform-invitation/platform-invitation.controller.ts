import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AcceptDto, LookupDto } from "./platform-invitation.dto.js";
import { PlatformInvitationService } from "./platform-invitation.service.js";
@ApiTags("platform-invitation")
@Controller("v1/platform-invitation")
@UseGuards(SessionGuard)
export class PlatformInvitationController {
  constructor(private readonly invitations: PlatformInvitationService) {}
  @Post("lookup")
  @HttpCode(200)
  lookup(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: LookupDto,
    @CorrelationId() correlationId?: string,
  ) {
    return this.invitations.act(session, body, false, correlationId);
  }
  @Post("accept")
  @HttpCode(204)
  accept(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AcceptDto,
    @CorrelationId() correlationId?: string,
  ) {
    return this.invitations.act(session, body, true, correlationId);
  }
}
