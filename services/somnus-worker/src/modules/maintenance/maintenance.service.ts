import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import type { Clock } from "../../common/clock.js";
import type { MorpheoMaintenanceClient } from "./morpheo-maintenance.client.js";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** The owner's decision of 2026-11-03 (ADR 0024); the module reads it from configuration. */
export const DEFAULT_FUNNEL_CASE_RETENTION_MONTHS = 24;

/**
 * `now` minus whole calendar months, in UTC. A day that does not exist in the
 * target month (31 March minus one month) becomes that month's last day, never
 * the start of the next: a record is never kept past, nor deleted before, the
 * period the privacy policy promises.
 */
export function subtractMonthsUtc(now: Date, months: number): Date {
  const target = new Date(now.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return target;
}

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
    private readonly funnelCaseRetentionMonths: number = DEFAULT_FUNNEL_CASE_RETENTION_MONTHS,
  ) {}

  cleanupUnclaimedAssessments(): Promise<MaintenanceDeleteResult> {
    const before = new Date(this.clock.now().getTime() - this.unclaimedTtlDays * MS_PER_DAY);
    return this.morpheo.deleteUnclaimedAssessments(before.toISOString());
  }

  cleanupExpiredClaimTokens(): Promise<MaintenanceDeleteResult> {
    const before = new Date(this.clock.now().getTime() - this.claimTokenTtlHours * MS_PER_HOUR);
    return this.morpheo.deleteExpiredClaimTokens(before.toISOString());
  }

  /** Case records of interviews started more than the retention period ago (ADR 0024). */
  cleanupFunnelCases(): Promise<MaintenanceDeleteResult> {
    const before = subtractMonthsUtc(this.clock.now(), this.funnelCaseRetentionMonths);
    return this.morpheo.deleteExpiredFunnelCases(before.toISOString());
  }
}
