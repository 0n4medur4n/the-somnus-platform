import { Body, Controller, HttpCode, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  BREAK_GLASS_EVENT_TYPE,
  type BreakGlassRevealResponse,
  opaqueId,
} from "@somnus/api-contracts";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { BreakGlassRevealDto } from "./admin.dto.js";
import { AdminAuditInterceptor, type RequestWithAuditDetail } from "./admin-audit.interceptor.js";
import { AdminBreakGlassService } from "./admin-break-glass.service.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminRoute } from "./admin-route.decorator.js";

/**
 * Break-glass access to an individual's clinical answers and results
 * (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * §A2.3 exists because "full access" for a platform admin is full OPERATIONAL
 * access — every user, every organization, every statistic, every log — and not
 * default visibility of one person's health answers. This route is the recorded
 * exception, and everything about its shape is meant to keep it exceptional.
 *
 * There is one route and it is a POST that reveals. There is deliberately no
 * "unlock" call, no session flag, no cookie and no token: the justification is a
 * required field of the only request the route accepts, so the data cannot be
 * fetched first and explained afterwards, and seeing it again tomorrow means
 * writing a justification again tomorrow. That is what §A2.3's "shown for that
 * session only" means in practice — there is no state to expire, because none
 * was ever created.
 *
 * The audit event is the point of the feature rather than a side effect of it,
 * so it carries what §A4 asks for: the record opened, the category, and the
 * admin's own words. It is emitted through the same interceptor as every other
 * admin route, enriched rather than duplicated, so the "exactly one audit event
 * per admin call" invariant from Checkpoint 15.1 still holds.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminBreakGlassController {
  constructor(private readonly breakGlass: AdminBreakGlassService) {}

  @Post("break-glass/reveal")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_break_glass",
    eventType: BREAK_GLASS_EVENT_TYPE,
    // The subject is the person whose record was opened, not the admin: an
    // audit log filtered by entity has to be able to find accesses to a user.
    entity: "user",
  })
  @ApiOperation({
    summary: "Reveal an individual's clinical results. Justification required (§A2.3).",
  })
  async reveal(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: BreakGlassRevealDto,
    @Req() request: RequestWithAuditDetail,
    @CorrelationId() correlationId?: string,
  ): Promise<BreakGlassRevealResponse> {
    // The guard resolved and approved the actor before this handler ran.
    const actorId = session?.somnusUserId ?? "";
    const correlation = correlationOf(correlationId);

    const { snapshots } = await this.breakGlass.assessmentsFor({
      subjectUserId: body.subjectUserId,
      actorId,
      correlationId: correlation,
    });

    // Minted here so the response can name the audit record this access wrote:
    // an admin should be able to find their own entry in the viewer, and a
    // reveal whose audit trail the admin cannot locate is harder to challenge.
    const auditEventId = opaqueId();
    request.adminAuditDetail = {
      eventId: auditEventId,
      subjectId: body.subjectUserId,
      data: {
        // Duplicates the envelope's actor deliberately: the analytics export
        // drops actor ids, so §A2.3's per-admin counter can only be computed
        // from a field inside `data`.
        adminId: actorId,
        category: body.category,
        // Lifted out of `data` into its own column by the worker on ingest, so
        // free text never reaches the analytics export (§9).
        justification: body.justification,
      },
    };

    return {
      subjectUserId: body.subjectUserId,
      revealedAt: new Date().toISOString(),
      auditEventId,
      snapshots,
    };
  }
}
