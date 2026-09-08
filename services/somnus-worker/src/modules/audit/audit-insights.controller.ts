import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard.js";
import { AuditQueryDto, DashboardWindowDto } from "./audit.dto.js";
import { AuditService } from "./audit.service.js";
import type { AuditViewRow } from "./export/audit-view.js";
import { toCsv } from "./export/audit-view.js";
import type { Dashboards } from "./export/dashboards.js";

/**
 * The statistics dashboards and audit log viewer (Addendum A §A2.4 /
 * Checkpoint 15.4). Private service, so edge-api is the only caller.
 *
 * **Authorization is not decided here.** Edge-api names the §A2.2 capability and
 * identity answers whether the actor holds it (build plan §5.3); this service
 * invents none of that. What it guarantees is the narrower thing it can: every
 * row leaves through the viewer's allowlist projection, so no caller can receive
 * a field and then decide for itself whether to render it.
 *
 * POST rather than GET for the query: the filters are a body-shaped contract
 * validated by Zod, and an audit query with an actor id in it does not belong in
 * a URL that lands in access logs.
 */
@ApiTags("audit")
@Controller({ path: "internal/v1/admin" })
@UseGuards(InternalAuthGuard)
export class AuditInsightsController {
  constructor(private readonly service: AuditService) {}

  @Post("dashboards")
  @ApiOperation({ summary: "Aggregate statistics over the privacy-safe export (§A2.4)." })
  async dashboards(@Body() body: DashboardWindowDto): Promise<Dashboards> {
    return this.service.dashboards({ from: body.from, to: body.to });
  }

  @Post("audit/query")
  @ApiOperation({ summary: "The audit log viewer: actor, entity, action, date range." })
  async query(@Body() body: AuditQueryDto): Promise<{ rows: AuditViewRow[] }> {
    return { rows: await this.service.query(body) };
  }

  @Post("audit/export")
  @ApiOperation({ summary: "The same rows as CSV. Edge-api restricts this to super admin." })
  async exportCsv(@Body() body: AuditQueryDto): Promise<{ csv: string; rowCount: number }> {
    // Serialized from the identical projection the viewer uses, so the file can
    // never contain a column the screen would not show.
    const rows = await this.service.query(body);
    return { csv: toCsv(rows), rowCount: rows.length };
  }
}
