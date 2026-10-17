import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import { MaintenanceDeleteResultSchema } from "@somnus/api-contracts";
import type { AuthHeaders } from "../../common/identity-token.js";

const noAuth: AuthHeaders = async () => ({});

/**
 * Calls Morpheo's retention endpoints (build plan §12.2). Morpheo owns the data
 * and performs the deletes; the worker only supplies the cutoff. Behind an
 * interface so the scheduled jobs are unit-tested without a live Morpheo.
 *
 * Morpheo is private, so on Cloud Run each call carries an ID token for
 * Morpheo's URL (`authHeaders`); without it Cloud Run answers 403.
 */
export interface MorpheoMaintenanceClient {
  deleteUnclaimedAssessments(before: string): Promise<MaintenanceDeleteResult>;
  deleteExpiredClaimTokens(before: string): Promise<MaintenanceDeleteResult>;
}

export class HttpMorpheoMaintenanceClient implements MorpheoMaintenanceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authHeaders: AuthHeaders = noAuth,
  ) {}

  deleteUnclaimedAssessments(before: string): Promise<MaintenanceDeleteResult> {
    return this.post("/internal/v1/maintenance/unclaimed-assessments/delete", before);
  }

  deleteExpiredClaimTokens(before: string): Promise<MaintenanceDeleteResult> {
    return this.post("/internal/v1/maintenance/claim-tokens/delete", before);
  }

  private async post(path: string, before: string): Promise<MaintenanceDeleteResult> {
    const base = this.baseUrl.replace(/\/$/, "");
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await this.authHeaders(base)) },
      body: JSON.stringify({ before }),
    });
    if (!response.ok) {
      throw new Error(`morpheo maintenance failed: ${response.status}`);
    }
    return MaintenanceDeleteResultSchema.parse(await response.json());
  }
}
