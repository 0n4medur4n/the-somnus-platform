import type { MaintenanceDeleteResult } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import type { Clock } from "../src/common/clock.js";
import {
  MaintenanceService,
  subtractMonthsUtc,
} from "../src/modules/maintenance/maintenance.service.js";
import type { MorpheoMaintenanceClient } from "../src/modules/maintenance/morpheo-maintenance.client.js";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const fixedClock: Clock = { now: () => NOW };

class CapturingClient implements MorpheoMaintenanceClient {
  unclaimedBefore: string | null = null;
  tokensBefore: string | null = null;
  casesBefore: string | null = null;

  async deleteUnclaimedAssessments(before: string): Promise<MaintenanceDeleteResult> {
    this.unclaimedBefore = before;
    return { deleted: 7 };
  }
  async deleteExpiredClaimTokens(before: string): Promise<MaintenanceDeleteResult> {
    this.tokensBefore = before;
    return { deleted: 2 };
  }
  async deleteExpiredFunnelCases(before: string): Promise<MaintenanceDeleteResult> {
    this.casesBefore = before;
    return { deleted: 1 };
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

describe("case records are kept 24 months (ADR 0024)", () => {
  it("deletes cases started before now - 24 months by default", async () => {
    const client = new CapturingClient();
    const result = await new MaintenanceService(fixedClock, client, 30, 72).cleanupFunnelCases();

    expect(client.casesBefore).toBe("2024-08-20T12:00:00.000Z");
    expect(result.deleted).toBe(1);
  });

  it("honours a configured retention", async () => {
    const client = new CapturingClient();
    await new MaintenanceService(fixedClock, client, 30, 72, 12).cleanupFunnelCases();
    expect(client.casesBefore).toBe("2025-08-20T12:00:00.000Z");
  });

  it("counts calendar months, and never rolls into the next month", () => {
    const cut = (iso: string, months: number) =>
      subtractMonthsUtc(new Date(iso), months).toISOString();
    expect(cut("2026-03-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z");
    expect(cut("2028-02-29T10:00:00.000Z", 24)).toBe("2026-02-28T10:00:00.000Z");
    expect(cut("2028-02-29T10:00:00.000Z", 12)).toBe("2027-02-28T10:00:00.000Z");
    expect(cut("2026-01-15T00:00:00.000Z", 24)).toBe("2024-01-15T00:00:00.000Z");
    expect(cut("2026-01-15T00:00:00.000Z", 1)).toBe("2025-12-15T00:00:00.000Z");
  });
});
