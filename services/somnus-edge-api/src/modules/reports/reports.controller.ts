import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { DEFAULT_LOCALE, isSupportedLocale, type ReportRef } from "@somnus/api-contracts";
import type { FastifyReply } from "fastify";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { CurrentSession } from "../sessions/current-session.decorator.js";
import { SessionGuard } from "../sessions/session.guard.js";
import type { SessionRecord } from "../sessions/session.service.js";
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

  @Get("assessments/:sessionId/pdf")
  @ApiOperation({ summary: "The signed-in person's report for one of their saved assessments." })
  async assessmentPdf(
    @CurrentSession() session: SessionRecord | undefined,
    @Param("sessionId") sessionId: string,
    @Query("locale") locale: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CorrelationId() correlationId?: string,
  ): Promise<Buffer> {
    const lng = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
    const pdf = await this.reports.assessmentPdf(session, sessionId, lng, correlationId);
    reply.header("content-type", "application/pdf");
    // Health data: never cached by anything between the person and edge-api.
    reply.header("cache-control", "no-store");
    reply.header(
      "content-disposition",
      `attachment; filename="the-somnus-informe-${pdf.createdAt.slice(0, 10)}.pdf"`,
    );
    reply.header("cross-origin-resource-policy", "same-site");
    return Buffer.from(pdf.pdfBase64, "base64");
  }
}
