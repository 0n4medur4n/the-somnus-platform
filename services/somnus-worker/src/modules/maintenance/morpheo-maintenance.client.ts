import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import { MaintenanceDeleteResultSchema } from "@somnus/api-contracts";

/**
 * Calls Morpheo's retention endpoints (build plan §12.2). Morpheo owns the data
 * and performs the deletes; the worker only supplies the cutoff. Behind an
 * interface so the scheduled jobs are unit-tested without a live Morpheo.
 */
export interface MorpheoMaintenanceClient {
  deleteUnclaimedAssessments(before: string): Promise<MaintenanceDeleteResult>;
  deleteExpiredClaimTokens(before: string): Promise<MaintenanceDeleteResult>;
}

export class HttpMorpheoMaintenanceClient implements MorpheoMaintenanceClient {
  constructor(private readonly baseUrl: string) {}

  deleteUnclaimedAssessments(before: string): Promise<MaintenanceDeleteResult> {
    return this.post("/internal/v1/maintenance/unclaimed-assessments/delete", before);
  }

  deleteExpiredClaimTokens(before: string): Promise<MaintenanceDeleteResult> {
    return this.post("/internal/v1/maintenance/claim-tokens/delete", before);
  }

  private async post(path: string, before: string): Promise<MaintenanceDeleteResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ before }),
    });
    if (!response.ok) {
      throw new Error(`morpheo maintenance failed: ${response.status}`);
    }
    return MaintenanceDeleteResultSchema.parse(await response.json());
  }
}
