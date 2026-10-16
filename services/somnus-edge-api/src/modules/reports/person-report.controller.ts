import { Controller, Get, Param, Query } from "@nestjs/common";
import { RouteConfig } from "@nestjs/platform-fastify";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type PersonReportResponse,
} from "@somnus/api-contracts";
import { CorrelationId } from "../../common/interceptors/correlation-id.decorator.js";
import { ReportProxyService } from "./reports.service.js";

/**
 * The person's report at the end of the questionnaire. As public as the result
 * it is built from (`GET /v1/assessments/:sessionId/summary`): the session id is
 * the capability, signed in or not. Rate-limited per IP, because a first view
 * makes a model call.
 */
@ApiTags("reports")
@Controller({ path: "v1/assessments" })
export class PersonReportController {
  constructor(private readonly reports: ReportProxyService) {}

  @Get(":sessionId/report")
  @RouteConfig({ rateLimit: { max: 20, timeWindow: 10 * 60_000 } })
  @ApiOperation({ summary: "The person's AI-written report for this assessment." })
  personReport(
    @Param("sessionId") sessionId: string,
    @Query("locale") locale: string | undefined,
    @CorrelationId() correlationId?: string,
  ): Promise<PersonReportResponse> {
    const lng = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
    return this.reports.personReport(sessionId, lng, correlationId);
  }
}
