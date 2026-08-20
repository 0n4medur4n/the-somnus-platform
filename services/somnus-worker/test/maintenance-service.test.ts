import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import type { Clock } from "../src/common/clock.js";
import { MaintenanceService } from "../src/modules/maintenance/maintenance.service.js";
import type { MorpheoMaintenanceClient } from "../src/modules/maintenance/morpheo-maintenance.client.js";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const fixedClock: Clock = { now: () => NOW };

class CapturingClient implements MorpheoMaintenanceClient {
  unclaimedBefore: string | null = null;
  tokensBefore: string | null = null;

  async deleteUnclaimedAssessments(before: string): Promise<MaintenanceDeleteResult> {
    this.unclaimedBefore = before;
    return { deleted: 7 };
  }
  async deleteExpiredClaimTokens(before: string): Promise<MaintenanceDeleteResult> {
    this.tokensBefore = before;
    return { deleted: 2 };
  }
}

describe("MaintenanceService (TTL with time control)", () => {
  it("deletes unclaimed assessments older than now - 30 days", async () => {
    const client = new CapturingClient();
    const result = await new MaintenanceService(
      fixedClock,
      client,
      30,
      72,
    ).cleanupUnclaimedAssessments();

    expect(client.unclaimedBefore).toBe(new Date(NOW.getTime() - 30 * 86_400_000).toISOString());
    expect(result.deleted).toBe(7);
  });

  it("deletes claim tokens older than now - 72 hours", async () => {
    const client = new CapturingClient();
    const result = await new MaintenanceService(
      fixedClock,
      client,
      30,
      72,
    ).cleanupExpiredClaimTokens();

    expect(client.tokensBefore).toBe(new Date(NOW.getTime() - 72 * 3_600_000).toISOString());
    expect(result.deleted).toBe(2);
  });

  it("honours a configured TTL override", async () => {
    const client = new CapturingClient();
    await new MaintenanceService(fixedClock, client, 7, 24).cleanupUnclaimedAssessments();
    expect(client.unclaimedBefore).toBe(new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
  });
});
