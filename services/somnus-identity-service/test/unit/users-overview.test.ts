import { describe, expect, it } from "vitest";
import {
  buildUsersOverview,
  overviewSince,
  weekStartUtc,
} from "../../src/modules/admin/users-overview.js";

/** The console overview's arithmetic (counts only, nothing identifying). */
describe("users overview", () => {
  const now = new Date("2026-10-18T12:00:00.000Z"); // a Sunday

  it("weeks start on Monday, UTC, and twelve of them are charted", () => {
    expect(weekStartUtc(now).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-10-12T00:00:00.000Z")).toISOString()).toBe(
      "2026-10-12T00:00:00.000Z",
    );
    expect(overviewSince(now).toISOString()).toBe("2026-07-27T00:00:00.000Z");
  });

  it("zero-fills every week, status and role, and buckets each day into its week", () => {
    const overview = buildUsersOverview({
      now,
      byStatus: [
        { status: "active", total: 40 },
        { status: "suspended", total: 2 },
      ],
      byRole: [
        { role: "adult", total: 30 },
        { role: "professional", total: 5 },
        { role: null, total: 7 },
      ],
      daily: [
        { day: "2026-07-27", total: 1 },
        { day: "2026-10-12", total: 3 },
        { day: "2026-10-18", total: 2 },
        { day: "2026-10-01", total: 4 },
        { day: "not-a-day", total: 99 },
      ],
    });
    expect(overview.total).toBe(42);
    expect(overview.byStatus).toEqual({ active: 40, suspended: 2, deleted: 0 });
    expect(overview.byRegistrationRole).toEqual({
      adult: 30,
      parent: 0,
      professional: 5,
      unknown: 7,
    });
    expect(overview.weekly).toHaveLength(12);
    expect(overview.weekly[0]).toEqual({ weekStart: "2026-07-27", count: 1 });
    expect(overview.weekly[11]).toEqual({ weekStart: "2026-10-12", count: 5 });
    expect(overview.weekly.reduce((n, w) => n + w.count, 0)).toBe(10);
    // Rolling windows count back from today, inclusive.
    expect(overview.newLast7Days).toBe(5);
    expect(overview.newLast30Days).toBe(9);
    expect(overview.generatedAt).toBe(now.toISOString());
  });

  it("an empty platform is all zeros, never missing keys", () => {
    const overview = buildUsersOverview({ now, byStatus: [], byRole: [], daily: [] });
    expect(overview.total).toBe(0);
    expect(overview.weekly.every((w) => w.count === 0)).toBe(true);
  });
});
