import { Inject, Injectable } from "@nestjs/common";
import { type DriveProofreadResult, DriveProofreadResultSchema } from "@somnus/api-contracts";
import type { CloudRunClient } from "@somnus/cloud-run-client";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { REPORT_CLIENT } from "../../infrastructure/internal-clients/internal-clients.module.js";

/** Carries the acting admin to the downstream service, as AdminProxyService does. */
const ACTOR_ID_HEADER = "x-somnus-actor-id";

/**
 * Proofreading a Drive document (owner decision 2026-11-02, ADR 0019). The
 * report service holds the provider abstraction (build plan §3.6), so the text
 * goes there, and only there; edge-api decides nothing about it.
 */
@Injectable()
export class AdminDriveProofreadService {
  constructor(@Inject(REPORT_CLIENT) private readonly report: CloudRunClient) {}

  async proofread(input: {
    body: unknown;
    actorId: string;
    correlationId: string;
  }): Promise<DriveProofreadResult> {
    const response = await this.report.post("/internal/v1/drive/proofread", {
      correlationId: input.correlationId,
      headers: { [ACTOR_ID_HEADER]: input.actorId },
      body: input.body,
    });
    const parsed = DriveProofreadResultSchema.safeParse(response.body);
    if (!parsed.success) {
      throw new SomnusError(ErrorCode.INTERNAL, "Unexpected report-service response.", {
        correlationId: input.correlationId,
      });
    }
    return parsed.data;
  }
}
