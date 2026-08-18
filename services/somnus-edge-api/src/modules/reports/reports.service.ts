import { Inject, Injectable } from "@nestjs/common";
import { type ReportRef, ReportRefSchema, type ReportRenderRequest } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { ZodType } from "zod";
import { correlationOf } from "../../common/composition.util.js";
import { REPORT_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/**
 * Proxies report rendering to the private report service (build plan §20
 * Checkpoint 11.1). edge-api only forwards an already-computed result and
 * returns the immutable ReportRef with short-lived signed URLs (§9); it never
 * renders or recalculates anything itself.
 */
@Injectable()
export class ReportProxyService {
  constructor(@Inject(REPORT_CLIENT) private readonly report: CloudRunClient) {}

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
