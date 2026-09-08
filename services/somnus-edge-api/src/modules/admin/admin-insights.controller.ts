import { Body, Controller, HttpCode, Post, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  type AuditViewPage,
  AuditViewPageSchema,
  type Dashboards,
  DashboardsSchema,
} from "@somnus/api-contracts";
import { z } from "zod";
import { correlationOf } from "../../common/composition.util.js";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
import { AdminAuditQueryDto, AdminDashboardWindowDto } from "./admin.dto.js";
import { AdminAuditInterceptor } from "./admin-audit.interceptor.js";
import { AdminCapabilityGuard } from "./admin-capability.guard.js";
import { AdminInsightsService } from "./admin-insights.service.js";
import { AdminRoute } from "./admin-route.decorator.js";

const CsvExportSchema = z.object({ csv: z.string(), rowCount: z.number().int().nonnegative() });
export type CsvExport = z.infer<typeof CsvExportSchema>;

/**
 * Statistics dashboards and the audit log viewer (Addendum A §A2.4 /
 * Checkpoint 15.4).
 *
 * Three routes, two capabilities, and the split between them is the point:
 *
 * * `admin_statistics_read` — aggregate numbers. §A2.2 gives it to
 *   `support_agent`, `clinical_governance_reviewer`, `platform_admin` and
 *   `platform_super_admin`; `professional_verifier` is not on that row.
 * * `admin_audit_read` — the on-screen log, for the narrower set §A2.2 lists.
 * * `admin_audit_export` — taking a copy of that log out of the platform, which
 *   §A4 Checkpoint 15.4 restricts to `platform_super_admin` alone. Reading a log
 *   and exporting it are different acts, so they are different capabilities;
 *   one capability could not have expressed both.
 *
 * Who holds each is identity's decision (`admin-capability-policy.ts`); this
 * controller only names them. Every route emits an audit event, reads included:
 * who looked at the audit log is itself an audit question.
 */
@ApiTags("admin")
@Controller({ path: "admin/v1" })
@UseGuards(SessionGuard, AdminCapabilityGuard)
@UseInterceptors(AdminAuditInterceptor)
export class AdminInsightsController {
  constructor(private readonly insights: AdminInsightsService) {}

  private actor(session: SessionRecord | undefined): string {
    // The guard resolved and approved the actor before this handler ran.
    return session?.somnusUserId ?? "";
  }

  @Post("statistics")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_statistics_read",
    eventType: "admin.statistics.viewed.v1",
    entity: "statistics",
  })
  @ApiOperation({ summary: "Aggregate platform statistics (§A2.4). Never per-person." })
  async statistics(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AdminDashboardWindowDto,
    @CorrelationId() correlationId?: string,
  ): Promise<Dashboards> {
    return this.insights.forward({
      path: "/internal/v1/admin/dashboards",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: DashboardsSchema,
      body,
    });
  }

  @Post("audit/query")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_audit_read",
    eventType: "admin.audit_log.viewed.v1",
    entity: "audit_record",
  })
  @ApiOperation({ summary: "The audit log: actor, entity, action and date-range filters." })
  async auditQuery(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AdminAuditQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<AuditViewPage> {
    return this.insights.forward({
      path: "/internal/v1/admin/audit/query",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: AuditViewPageSchema,
      body,
    });
  }

  @Post("audit/export")
  @HttpCode(200)
  @AdminRoute({
    capability: "admin_audit_export",
    eventType: "admin.audit_log.exported.v1",
    entity: "audit_record",
  })
  @ApiOperation({ summary: "The same rows as CSV. platform_super_admin only." })
  async auditExport(
    @CurrentSession() session: SessionRecord | undefined,
    @Body() body: AdminAuditQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<CsvExport> {
    return this.insights.forward({
      path: "/internal/v1/admin/audit/export",
      actorId: this.actor(session),
      correlationId: correlationOf(correlationId),
      schema: CsvExportSchema,
      body,
    });
  }
}
