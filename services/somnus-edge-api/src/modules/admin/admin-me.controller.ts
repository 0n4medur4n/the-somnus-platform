import { Controller, Get, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AdminMeResponse } from "@somnus/api-contracts";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AdminProxyService } from "./admin.service.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminRoute } from "./admin-route.decorator.js";

/**
 * The admin console's shell endpoint (Addendum A Checkpoint 15.1). The console
 * calls this immediately after the session exchange; if the session carries no
 * internal role it gets a 403 and renders nothing but the denial screen.
 *
 * Guarded twice, in order: `SessionGuard` (is there a session at all) then
 * `AdminCapabilityGuard` (may this session be here). Every handler under
 * `/admin/v1` carries the audit interceptor.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminMeController {
  constructor(private readonly admin: AdminProxyService) {}

  @Get("me")
  @AdminRoute({
    capability: "any_internal_role",
    eventType: "admin.session.opened.v1",
    entity: "admin_session",
  })
  @ApiOperation({ summary: "Who the console is talking to, and what they may do." })
  async me(
    @CurrentSession() session: SessionRecord | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<AdminMeResponse> {
    const id = correlationOf(correlationId);
    // The guard already resolved and approved the actor; it is on the session.
    return this.admin.me(session?.somnusUserId ?? "", id);
  }
}
