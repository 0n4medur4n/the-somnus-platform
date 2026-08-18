import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ReportRef } from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import { ReportRenderDto } from "./reports.dto.js";
import { ReportProxyService } from "./reports.service.js";

/**
 * Reports are health data, so this route is authenticated (session-guarded) and
 * CSRF-protected as a state-changing POST. It returns the report's short-lived
 * signed URLs (build plan §9: authenticated endpoints + signed URLs).
 */
@ApiTags("reports")
@Controller({ path: "v1/reports" })
@UseGuards(SessionGuard)
export class ReportsController {
  constructor(private readonly reports: ReportProxyService) {}

  @Post()
  @ApiOperation({ summary: "Render a report from an approved assessment result." })
  render(
    @Body() body: ReportRenderDto,
    @CorrelationId() correlationId?: string,
  ): Promise<ReportRef> {
    return this.reports.render(body, correlationId);
  }
}
