import type { AuditExportRow } from "./audit-exporter.js";
import { buildFunnels, type Funnels } from "./funnels.js";

/**
 * The Phase 15 statistics dashboards (Addendum A §A2.4 / Checkpoint 15.4).
 *
 * A pure projection over the **exported** rows, exactly like `funnels.ts` and for
 * the same reason: whatever the dashboard shows, it computes from precisely the
 * rows that reach BigQuery, so a redaction can never change a metric without
 * changing this function's output. It is also the executable specification of the
 * BigQuery queries.
 *
 * ## What §A2.4 asks for, and what the export can actually answer
 *
 * Checkpoint 14.3 exports two kinds of row. **Analytics events** carry a
 * `.strict()` payload — a role branch, an opaque id, a decision, a duration — so
 * anything built on their FIELDS is sound. **Every other event type** is exported
 * through the denylist, meaning its `data` is whatever the producer sent minus
 * forbidden keys: its shape is not guaranteed, so only the fact that the event
 * occurred can be trusted. Counting by `eventType` is therefore safe for both;
 * reading a field is only safe for the first.
 *
 * That line is what splits §A2.4 in two, and the split is reported rather than
 * papered over. `unavailable` below names every metric §A2.4 lists that no event
 * carries, with the reason. Those are not rendered as zero: a zero is a
 * measurement, and claiming one where nothing is measured is worse than an
 * honest gap. The single exception is break-glass, which §A4 Checkpoint 15.4
 * explicitly wants wired and showing zero until 15.5 builds the feature.
 *
 * Neither of §A2.4's filter axes — locale and product — exists in any payload, so
 * this projection groups by time only. Adding them means instrumenting the
 * producers, which is a separate decision.
 */

/** Event types counted directly. Occurrence is trustworthy for any regime. */
const COUNTED = {
  assessmentsStarted: "morpheo.assessment.created.v1",
  assessmentsCompleted: "morpheo.assessment.completed.v1",
  reportsRequested: "report.generation.requested.v1",
  reportsGenerated: "report.generated.v1",
  notificationsRequested: "notification.email.requested.v1",
  organizationsCreated: "identity.organization.created.v1",
} as const;

export type CountedMetric = keyof typeof COUNTED;

export type UnavailableMetric = {
  /** The §A2.4 wording, so the gap is traceable to the plan. */
  metric: string;
  reason: string;
};

/**
 * Every §A2.4 metric with no event behind it. Deliberately data, not prose in a
 * README: the dashboard renders this list, so the operator reading the screen
 * sees why a number is missing instead of assuming the platform is idle.
 */
export const UNAVAILABLE_METRICS: ReadonlyArray<UnavailableMetric> = [
  {
    metric: "Assessments claimed; drop-off by state-machine step",
    reason: "no event marks a claim or a per-step transition",
  },
  {
    metric: "Distribution of L-levels (L0-L4)",
    reason: "no exported event carries the level; morpheo.assessment.completed.v1 does not",
  },
  { metric: "PDF downloads", reason: "no event is emitted when a signed URL is fetched" },
  {
    metric: "Notification delivery success/failure",
    reason: "only notification.email.requested.v1 exists; no delivery outcome event",
  },
  { metric: "Dead-letter counts", reason: "no dead-letter event type is registered" },
  {
    metric: "Organizations: active members",
    reason: "membership changes emit no event; only organization creation does",
  },
  {
    metric: "Cost telemetry (Cloud Run requests, cold starts)",
    reason: "not exported; §A2.4 asks for it only 'if already exported'",
  },
  {
    metric: "Filter by locale and by product",
    reason: "no exported payload carries a locale or a product dimension",
  },
];

/** The earliest and latest `occurredAt` seen, or null when there is nothing. */
export type DashboardWindow = { from: string; to: string } | null;

export type Dashboards = {
  /** Registration, verification and invitation, from the strict analytics payloads. */
  funnels: Funnels;
  /** Occurrence counts, safe for both export regimes. */
  counts: Record<CountedMetric, number>;
  /**
   * Break-glass accesses per admin. Wired now and empty until Checkpoint 15.5
   * builds the feature (§A4): a slot showing zero, not an absent panel, so the
   * dashboard's shape does not change when the feature lands.
   */
  breakGlassByAdmin: Record<string, number>;
  /** §A2.4 metrics nothing currently measures. Rendered as gaps, never as zero. */
  unavailable: ReadonlyArray<UnavailableMetric>;
  /** Rows the projection actually saw, so an empty dashboard is legible as empty. */
  rowsConsidered: number;
  /**
   * True when the read hit its cap, so the numbers are a lower bound rather than
   * a total. Surfaced instead of hidden: a partial count presented as a total is
   * a wrong number, and a dashboard's whole value is that its numbers are right.
   */
  truncated: boolean;
  /** The span the numbers cover, or null when there is nothing to show. */
  window: DashboardWindow;
};

export function projectDashboards(
  rows: ReadonlyArray<AuditExportRow>,
  options: { truncated?: boolean } = {},
): Dashboards {
  const counts = Object.fromEntries(
    (Object.keys(COUNTED) as CountedMetric[]).map((metric) => [metric, 0]),
  ) as Record<CountedMetric, number>;

  const byEventType = new Map<string, CountedMetric>(
    (Object.keys(COUNTED) as CountedMetric[]).map((metric) => [COUNTED[metric], metric]),
  );

  for (const row of rows) {
    const metric = byEventType.get(row.eventType);
    if (metric) counts[metric] += 1;
  }

  return {
    funnels: buildFunnels(rows),
    counts,
    // Empty by construction until 15.5. The exporter drops actor ids, so even
    // when the feature exists this can only ever be per-admin if the break-glass
    // event carries an opaque admin id in its own strict payload.
    breakGlassByAdmin: {},
    unavailable: UNAVAILABLE_METRICS,
    rowsConsidered: rows.length,
    truncated: options.truncated ?? false,
    window: dashboardWindow(rows),
  };
}

/** The time span the numbers cover, for the dashboard header. */
export function dashboardWindow(rows: ReadonlyArray<AuditExportRow>): DashboardWindow {
  if (rows.length === 0) return null;
  const stamps = rows.map((row) => row.occurredAt).sort();
  const from = stamps[0];
  const to = stamps[stamps.length - 1];
  return from !== undefined && to !== undefined ? { from, to } : null;
}
