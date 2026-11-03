import { Body, Controller, HttpCode, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type FunnelCase,
  FunnelCaseSchema,
  type FunnelCaseStats,
  FunnelCaseStatsSchema,
  opaqueId,
} from "@somnus/api-contracts";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { MorpheoCaseOpenDto, MorpheoCaseStatsDto } from "./admin.dto.js";
import { AdminAuditInterceptor, type RequestWithAuditDetail } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminMorpheoCasesService } from "./admin-morpheo-cases.service.js";
import { AdminRoute } from "./admin-route.decorator.js";

/** The event an opening writes, beside morpheo's own record of it. */
export const MORPHEO_CASE_OPENED_EVENT_TYPE = "admin.morpheo_case.opened.v1";

/**
 * Morpheo's case records in the console (ADR 0024).
 *
 * Two routes, two capabilities, and the split is the point. Statistics are
 * aggregate counts over every interview -- no case, no person -- so they sit
 * with the other dashboards under `admin_statistics_read`. Opening one case
 * shows a whole interview's health answers, so it is `admin_morpheo_case_read`
 * (super admin alone) and it is shaped like break-glass: one POST, the category
 * and the justification required by the DTO, nothing to unlock, nothing kept.
 *
 * Morpheo writes the durable record of each opening (who, when, which category,
 * the admin's words) before it answers, and returns it with the case; the audit
 * event below is the platform's usual one-per-admin-call, without the free text.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1/morpheo" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminMorpheoCasesController {
  constructor(private readonly cases: AdminMorpheoCasesService) {}

  @Post("statistics")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_statistics_read",
    eventType: "admin.morpheo_statistics.viewed.v1",
    entity: "statistics",
  })
  @ApiOperation({
    summary: "Counts over Morpheo's interviews (ADR 0024). Never a case or a person.",
  })
  async statistics(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: MorpheoCaseStatsDto,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelCaseStats> {
    return this.cases.forward({
      path: "/internal/v1/funnel/cases/stats",
      // The guard resolved and approved the actor before this handler ran.
      actorId: session?.somnusUserId ?? "",
      correlationId: correlationOf(correlationId),
      schema: FunnelCaseStatsSchema,
      body,
    });
  }

  @Post("cases/open")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_morpheo_case_read",
    eventType: MORPHEO_CASE_OPENED_EVENT_TYPE,
    entity: "morpheo_case",
  })
  @ApiOperation({
    summary: "One Morpheo case by its code: questions, answers, results. Justification required.",
  })
  async open(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: MorpheoCaseOpenDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<FunnelCase> {
    const actorId = session?.somnusUserId ?? "";
    const opened = await this.cases.forward({
      path: "/internal/v1/funnel/cases/open",
      actorId,
      correlationId: correlationOf(correlationId),
      schema: FunnelCaseSchema,
      body,
    });
    request.adminAuditDetail = {
      eventId: opaqueId(),
      // The case code is the subject: an audit log filtered by entity must find
      // every opening of a case. It names an interview, never a person.
      subjectId: opened.caseCode,
      // No justification here: the event reaches the logs, and the admin's own
      // words stay in morpheo's record of the access, returned with the case.
      data: { adminId: actorId, category: body.category },
    };
    return opened;
  }
}
