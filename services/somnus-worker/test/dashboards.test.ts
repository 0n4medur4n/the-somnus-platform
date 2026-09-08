import { describe, expect, it } from "vitest";
import type { AuditExportRow } from "../src/modules/audit/export/audit-exporter.js";
import { FORBIDDEN_DATA_KEYS } from "../src/modules/audit/export/audit-exporter.js";
import {
  AUDIT_VIEW_FIELDS,
  type AuditViewRow,
  redactViewData,
  toAuditViewRow,
  toCsv,
} from "../src/modules/audit/export/audit-view.js";
import {
  dashboardWindow,
  projectDashboards,
  UNAVAILABLE_METRICS,
} from "../src/modules/audit/export/dashboards.js";

/**
 * The Phase 15 dashboards and audit viewer (Addendum A §A2.4 / Checkpoint 15.4).
 *
 * The numbers are reconciled against a seed whose totals are stated up front, the
 * same way Checkpoint 14.3's funnel reconciliation does it: the test knows what
 * it put in, so a number that does not match is a projection bug rather than a
 * disagreement between two pieces of arithmetic.
 *
 * The redaction assertions are deliberately NOT "this seeded row looks fine".
 * They are built from `FORBIDDEN_DATA_KEYS` itself, so a key added to that set
 * later is covered without anyone remembering to extend the test, and a field
 * added to the store does not reach the screen unless someone adds it to the
 * allowlist on purpose.
 */

function row(eventType: string, over: Partial<AuditExportRow> = {}): AuditExportRow {
  return {
    eventId: `e-${Math.random().toString(36).slice(2)}`,
    eventType,
    occurredAt: "2026-09-01T10:00:00Z",
    producer: "somnus-identity-service",
    correlationId: "corr-1",
    actorType: null,
    subjectType: "user",
    data: {},
    ...over,
  };
}

/**
 * A seed with stated totals. Registration/verification/invitation come from the
 * strict analytics payloads; the rest are counted by occurrence.
 */
const SEED: AuditExportRow[] = [
  // 3 registrations completed: 2 adult, 1 professional.
  row("identity.registration.completed.v1", { data: { roleBranch: "adult" } }),
  row("identity.registration.completed.v1", { data: { roleBranch: "adult" } }),
  row("identity.registration.completed.v1", { data: { roleBranch: "professional" } }),
  // 2 assessments started, 1 completed.
  row("morpheo.assessment.created.v1", { occurredAt: "2026-09-02T10:00:00Z" }),
  row("morpheo.assessment.created.v1"),
  row("morpheo.assessment.completed.v1"),
  // 2 reports requested, 2 generated.
  row("report.generation.requested.v1"),
  row("report.generation.requested.v1"),
  row("report.generated.v1"),
  row("report.generated.v1", { occurredAt: "2026-09-05T10:00:00Z" }),
  // 1 notification requested, 1 organization created.
  row("notification.email.requested.v1"),
  row("identity.organization.created.v1"),
  // Noise the dashboard must ignore rather than miscount.
  row("admin.user.viewed.v1"),
  row("consent.receipt.recorded.v1"),
];

describe("the dashboards reproduce a known seed", () => {
  const dashboards = projectDashboards(SEED);

  it("counts registrations per role branch from the strict payload", () => {
    expect(dashboards.funnels.registration.completed.adult).toBe(2);
    expect(dashboards.funnels.registration.completed.professional).toBe(1);
  });

  it.each([
    ["assessmentsStarted", 2],
    ["assessmentsCompleted", 1],
    ["reportsRequested", 2],
    ["reportsGenerated", 2],
    ["notificationsRequested", 1],
    ["organizationsCreated", 1],
  ] as const)("counts %s as %i", (metric, expected) => {
    expect(dashboards.counts[metric]).toBe(expected);
  });

  it("ignores event types no dashboard metric claims", () => {
    // The two noise rows must not land anywhere. Their absence is what makes the
    // totals above trustworthy rather than coincidental.
    const total = Object.values(dashboards.counts).reduce((sum, value) => sum + value, 0);

    expect(total).toBe(9);
    expect(dashboards.rowsConsidered).toBe(SEED.length);
  });

  it("reports the window the numbers cover", () => {
    expect(dashboardWindow(SEED)).toEqual({
      from: "2026-09-01T10:00:00Z",
      to: "2026-09-05T10:00:00Z",
    });
  });

  it("has no window at all when there is nothing to show", () => {
    expect(dashboardWindow([])).toBeNull();
  });
});

describe("a metric with nothing behind it is a gap, not a zero", () => {
  const dashboards = projectDashboards(SEED);

  it.each([
    "Distribution of L-levels (L0-L4)",
    "PDF downloads",
    "Notification delivery success/failure",
    "Dead-letter counts",
    "Organizations: active members",
  ])("%s is reported as unavailable, with a reason", (metric) => {
    const entry = dashboards.unavailable.find((item) => item.metric === metric);

    expect(entry, `${metric} must be declared unavailable`).toBeDefined();
    expect(entry?.reason.length).toBeGreaterThan(10);
  });

  it("never invents a zero for something nothing measures", () => {
    // A zero is a measurement. Rendering one where no event exists would tell an
    // operator the platform is idle when the truth is that nobody is counting.
    const counted = Object.keys(dashboards.counts);

    for (const gap of UNAVAILABLE_METRICS) {
      expect(counted).not.toContain(gap.metric);
    }
  });

  it("break-glass is the one deliberate zero: wired, empty, and present", () => {
    // §A4 Checkpoint 15.4 asks for the slot now so the dashboard's shape does not
    // change when 15.5 lands.
    expect(dashboards.breakGlassByAdmin).toEqual({});
  });

  it("says out loud that locale and product cannot be filtered", () => {
    const entry = dashboards.unavailable.find((item) => item.metric.includes("locale"));

    expect(entry).toBeDefined();
  });
});

describe("the dashboards are empty, not broken, with no data at all", () => {
  // The state of dev until the event transport is wired: every number is a real
  // zero over zero rows, and the screen must be legible as such.
  const empty = projectDashboards([]);

  it("returns zeros and an explicit row count", () => {
    expect(empty.rowsConsidered).toBe(0);
    expect(Object.values(empty.counts).every((value) => value === 0)).toBe(true);
    expect(empty.funnels.verification.opened).toBe(0);
  });

  it("still declares the same gaps", () => {
    expect(empty.unavailable).toEqual(UNAVAILABLE_METRICS);
  });
});

describe("the audit viewer cannot render a field outside its allowlist", () => {
  /** A stored row carrying every forbidden key, plus columns nobody declared. */
  function hostileRow(): Record<string, unknown> {
    const data: Record<string, unknown> = { safeDimension: "keep-me" };
    for (const key of FORBIDDEN_DATA_KEYS) data[key] = "SHOULD-NEVER-APPEAR";
    return {
      id: "surrogate-key",
      eventId: "e1",
      eventType: "identity.user.created.v1",
      occurredAt: "2026-09-01T10:00:00Z",
      receivedAt: "2026-09-01T10:00:01Z",
      producer: "somnus-identity-service",
      correlationId: "corr-1",
      actorType: "admin",
      actorId: "actor-1",
      subjectType: "user",
      subjectId: "subject-1",
      data,
      // Columns a future migration might add. The viewer must not carry them.
      internalNotes: "SHOULD-NEVER-APPEAR",
      rawPayload: "SHOULD-NEVER-APPEAR",
    };
  }

  it("emits exactly the declared fields, whatever the row contains", () => {
    const view = toAuditViewRow(hostileRow());

    expect(Object.keys(view).sort()).toEqual([...AUDIT_VIEW_FIELDS].sort());
  });

  it("drops the surrogate key and any undeclared column", () => {
    const view = toAuditViewRow(hostileRow()) as Record<string, unknown>;

    expect(view["id"]).toBeUndefined();
    expect(view["internalNotes"]).toBeUndefined();
    expect(view["rawPayload"]).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("SHOULD-NEVER-APPEAR");
  });

  it.each([...FORBIDDEN_DATA_KEYS])("strips the forbidden data key %s", (key) => {
    // Built from the set itself, so a key added to it later is covered without
    // anyone remembering to come back here.
    const view = toAuditViewRow(hostileRow());

    expect(Object.keys(view.data)).not.toContain(key);
  });

  it("keeps the dimensions that are the point of an audit log", () => {
    const view = toAuditViewRow(hostileRow());

    expect(view.actorId).toBe("actor-1");
    expect(view.subjectType).toBe("user");
    expect(view.data["safeDimension"]).toBe("keep-me");
  });

  it("survives a row whose data is not an object at all", () => {
    for (const value of [null, undefined, "text", 42, ["a"]]) {
      expect(redactViewData(value)).toEqual({});
    }
  });
});

describe("the CSV export carries no more than the screen", () => {
  const view: AuditViewRow = toAuditViewRow({
    eventId: "e1",
    eventType: "identity.user.created.v1",
    occurredAt: "2026-09-01T10:00:00Z",
    receivedAt: "2026-09-01T10:00:01Z",
    producer: "somnus-identity-service",
    correlationId: "corr-1",
    actorType: "admin",
    actorId: "actor-1",
    subjectType: "user",
    subjectId: "subject-1",
    data: Object.fromEntries([
      ...[...FORBIDDEN_DATA_KEYS].map((key) => [key, "SHOULD-NEVER-APPEAR"]),
      ["safeDimension", "keep-me"],
    ]),
  });

  it("has exactly the allowlist as its header", () => {
    expect(toCsv([view]).split("\n")[0]).toBe(AUDIT_VIEW_FIELDS.join(","));
  });

  it("contains no forbidden field anywhere in the file", () => {
    expect(toCsv([view])).not.toContain("SHOULD-NEVER-APPEAR");
  });

  it("keeps the safe dimensions", () => {
    expect(toCsv([view])).toContain("keep-me");
  });

  it("neutralises a cell a spreadsheet would run as a formula", () => {
    const dangerous = toAuditViewRow({
      eventId: "=cmd|'/c calc'!A1",
      eventType: "identity.user.created.v1",
      occurredAt: "2026-09-01T10:00:00Z",
      receivedAt: "2026-09-01T10:00:01Z",
      producer: "p",
      correlationId: "c",
      actorType: null,
      actorId: null,
      subjectType: "user",
      subjectId: "s",
      data: {},
    });

    // An audit export exists to be opened in a spreadsheet, so the injection is
    // not hypothetical.
    expect(toCsv([dangerous])).toContain("\"'=cmd");
  });

  it("escapes quotes rather than breaking the row", () => {
    const quoted = toAuditViewRow({
      eventId: 'e"1',
      eventType: "identity.user.created.v1",
      occurredAt: "2026-09-01T10:00:00Z",
      receivedAt: "2026-09-01T10:00:01Z",
      producer: "p",
      correlationId: "c",
      actorType: null,
      actorId: null,
      subjectType: "user",
      subjectId: "s",
      data: {},
    });

    expect(toCsv([quoted]).split("\n")).toHaveLength(2);
    expect(toCsv([quoted])).toContain('"e""1"');
  });

  it("is a header and nothing else for an empty result", () => {
    expect(toCsv([])).toBe(AUDIT_VIEW_FIELDS.join(","));
  });
});
