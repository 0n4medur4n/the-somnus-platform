import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import type { Clock } from "../../common/clock.js";
import type { MorpheoMaintenanceClient } from "./morpheo-maintenance.client.js";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * The retention jobs (build plan §12.2), triggered by Cloud Scheduler. Each job
 * computes its cutoff from the injectable clock (now - TTL) — so the TTL is
 * deterministic under test — and asks Morpheo to delete rows older than it.
 */
export class MaintenanceService {
  constructor(
    private readonly clock: Clock,
    private readonly morpheo: MorpheoMaintenanceClient,
    private readonly unclaimedTtlDays: number,
    private readonly claimTokenTtlHours: number,
  ) {}

  cleanupUnclaimedAssessments(): Promise<MaintenanceDeleteResult> {
    const before = new Date(this.clock.now().getTime() - this.unclaimedTtlDays * MS_PER_DAY);
    return this.morpheo.deleteUnclaimedAssessments(before.toISOString());
  }

  cleanupExpiredClaimTokens(): Promise<MaintenanceDeleteResult> {
    const before = new Date(this.clock.now().getTime() - this.claimTokenTtlHours * MS_PER_HOUR);
    return this.morpheo.deleteExpiredClaimTokens(before.toISOString());
  }
}
