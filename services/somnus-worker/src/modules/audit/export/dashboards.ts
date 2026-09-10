import { BREAK_GLASS_EVENT_TYPE, BreakGlassEventDataSchema } from "@somnus/api-contracts";
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
 * honest gap. Break-glass was the one slot deliberately wired and left at zero
 * by 15.4; Checkpoint 15.5 makes it a real count, through this same projection
 * and no other path.
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
   * Break-glass accesses, per admin and per calendar month (Addendum A §A2.3
   * point 4: "so abuse is visible, not hidden"). Outer key is the opaque admin
   * id, inner key is `YYYY-MM` in UTC.
   *
   * Per month, rather than a single total over whatever window was asked for.
   * A total labelled "per month" is a wrong number the moment somebody widens
   * the window, and the reason this metric exists is that someone will read it
   * looking for a pattern.
   */
  breakGlassByAdmin: Record<string, Record<string, number>>;
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
    breakGlassByAdmin: breakGlassByAdmin(rows),
    unavailable: UNAVAILABLE_METRICS,
    rowsConsidered: rows.length,
    truncated: options.truncated ?? false,
    window: dashboardWindow(rows),
  };
}

/**
 * Break-glass accesses per admin per month, from the same exported rows as every
 * other number on this dashboard (Checkpoint 15.5).
 *
 * The admin id comes out of `data`, not out of `actorId`, and that is not a
 * shortcut: `redactForExport` drops actor and subject ids before a row leaves
 * the worker, so a per-admin count is only possible for an event that puts an
 * opaque admin id in its own payload. The break-glass event does exactly that
 * and carries nothing else identifying -- no subject, no justification.
 *
 * The payload is validated rather than trusted. A row whose `data` does not
 * match the contract is not counted: an audit metric that quietly counts
 * malformed rows tells you a number without telling you what it counted.
 */
function breakGlassByAdmin(
  rows: ReadonlyArray<AuditExportRow>,
): Record<string, Record<string, number>> {
  const byAdmin: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (row.eventType !== BREAK_GLASS_EVENT_TYPE) continue;
    const parsed = BreakGlassEventDataSchema.safeParse(row.data);
    if (!parsed.success) continue;
    const month = monthOf(row.occurredAt);
    if (month === null) continue;
    const months = byAdmin[parsed.data.adminId] ?? {};
    months[month] = (months[month] ?? 0) + 1;
    byAdmin[parsed.data.adminId] = months;
  }
  return byAdmin;
}

/** `YYYY-MM` in UTC, or null if the stamp is not a date we can place in a month. */
function monthOf(occurredAt: string): string | null {
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The time span the numbers cover, for the dashboard header. */
export function dashboardWindow(rows: ReadonlyArray<AuditExportRow>): DashboardWindow {
  if (rows.length === 0) return null;
  const stamps = rows.map((row) => row.occurredAt).sort();
  const from = stamps[0];
  const to = stamps[stamps.length - 1];
  return from !== undefined && to !== undefined ? { from, to } : null;
}
