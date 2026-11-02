import { Inject, Injectable } from "@nestjs/common";
import { type DriveTranslateResult, DriveTranslateResultSchema } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { REPORT_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin to the downstream service, as AdminProxyService does. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * Translating what is read aloud (owner decision 2026-11-03, ADR 0019). The
 * report service holds the provider abstraction (build plan §3.6), so the
 * passages go there, and only there; edge-api decides nothing about them. One
 * translation comes back per passage sent, or the answer is refused.
 */
@Injectable()
export class AdminDriveTranslateService {
  constructor(@Inject(REPORT_CLIENT) private readonly report: CloudRunClient) {}

  async translate(input: {
    body: { passages: string[] };
    actorId: string;
    correlationId: string;
  }): Promise<DriveTranslateResult> {
    const response = await this.report.post("/internal/v1/drive/translate", {
      correlationId: input.correlationId,
      headers: { [ACTOR_ID_HEADER]: input.actorId },
      body: input.body,
      // As proofreading: the model takes seconds, more on a cold start; wait,
      // and never ask twice (a retry would run, and bill, it again).
      timeoutMs: 50_000,
      skipRetry: true,
    });
    const parsed = DriveTranslateResultSchema.safeParse(response.body);
    if (!parsed.success || parsed.data.passages.length !== input.body.passages.length) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected report-service response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
