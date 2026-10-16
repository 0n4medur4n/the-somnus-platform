import { Inject, Injectable } from "@nestjs/common";
import {
  type ReportPdf,
  ReportPdfSchema,
  type ReportRef,
  ReportRefSchema,
  type ReportRenderRequest,
  type SupportedLocale,
} from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { correlationOf } from "../../common/composition.util.js";
import { REPORT_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";
import { MorpheoProxyService } from "../morpheo/morpheo.service.js";
import type { SessionRecord } from "../sessions/session.service.js";

/**
 * Proxies report rendering to the private report service (build plan §20
 * Checkpoint 11.1). edge-api only forwards an already-computed result and
 * returns the immutable ReportRef with short-lived signed URLs (§9); it never
 * renders or recalculates anything itself.
 */
@Injectable()
export class ReportProxyService {
  constructor(
    @Inject(REPORT_CLIENT) private readonly report: CloudRunClient,
    private readonly morpheo: MorpheoProxyService,
  ) {}

  /**
   * The signed-in person's report for one of THEIR saved assessments, as a PDF.
   *
   * Built here from Morpheo's frozen snapshot -- never from anything the browser
   * sends -- so a report can only ever say what the assessment actually found.
   * Morpheo scopes the snapshot to the actor, so someone else's assessment is
   * simply not found. Rendered on demand and not stored.
   */
  async assessmentPdf(
    session: SessionRecord | undefined,
    sessionId: string,
    locale: SupportedLocale,
    rawCorrelationId?: string,
  ): Promise<ReportPdf> {
    const correlationId = correlationOf(rawCorrelationId);
    const [snapshot, mine] = await Promise.all([
      this.morpheo.snapshot(session, sessionId, correlationId),
      this.morpheo.mine(session, correlationId),
    ]);
    const saved = mine.assessments.find((assessment) => assessment.sessionId === sessionId);
    if (!saved) {
      throw new SomnusError(ErrorCode.NOT_FOUND, "Assessment not found.", { correlationId });
    }
    const body: ReportRenderRequest = {
      assessmentId: snapshot.sessionId,
      definitionVersion: snapshot.workflowVersion,
      contentVersion: snapshot.contentVersion,
      locale,
      role: snapshot.result.role,
      level: snapshot.result.level,
      stop: snapshot.result.stop,
      triggeredRules: snapshot.result.triggeredRules,
      routes: snapshot.result.routes,
      completedAt: saved.createdAt,
    };
    const response = await this.report.post("/internal/v1/reports/pdf", { correlationId, body });
    return this.parse(ReportPdfSchema, response.body, correlationId);
  }

  async render(body: ReportRenderRequest, rawCorrelationId?: string): Promise<ReportRef> {
    const correlationId = correlationOf(rawCorrelationId);
    const response = await this.report.post("/internal/v1/reports", { correlationId, body });
    return this.parse(ReportRefSchema, response.body, correlationId);
  }

  private parse<T>(schema: ZodType<T>, body: unknown, correlationId: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected report response.", { correlationId });
    }
    return parsed.data;
  }
}
