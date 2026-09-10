import { FORBIDDEN_DATA_KEYS } from "./audit-exporter.js";

/**
 * The audit log viewer's projection (Addendum A §A2.4 / Checkpoint 15.4).
 *
 * `somnus_audit` stores provenance, never a copy of anyone's data, and the §17
 * envelope already forbids secrets, health data and free text from reaching it.
 * That makes the store safe, and it is still not a licence to render whatever a
 * row happens to contain: `data` is a JSON column, so its keys are whatever a
 * producer put there, and a producer is exactly the thing defence in depth
 * assumes might misbehave.
 *
 * So the viewer projects through an explicit ALLOWLIST of columns and reuses the
 * exporter's `FORBIDDEN_DATA_KEYS` on `data`. Two consequences worth stating:
 *
 * * A column added to `audit_records` later does not appear in the viewer by
 *   default. Someone has to add it here, deliberately, which is the point.
 * * The viewer can never show a `data` key the analytics export would strip, so
 *   the two surfaces cannot disagree about what is safe to display.
 *
 * `justification` is the third field that travels here and not to BigQuery, for
 * the same kind of reason and a stronger one: it is free text, §9 forbids that
 * in the warehouse outright, and the export row has no field it could occupy.
 *
 * `subjectId` and `actorId` DO travel, unlike in the BigQuery export, and that
 * asymmetry is deliberate: §A2.4 requires filtering by actor, and an audit log
 * that cannot say who did what to whom is not an audit log. They are opaque ids,
 * never names or addresses.
 */

/**
 * Every field the viewer may render. The surrogate primary key is deliberately
 * absent: it identifies a row in a table, answers no audit question, and would
 * only invite someone to treat it as a stable external reference.
 */
export const AUDIT_VIEW_FIELDS = [
  "eventId",
  "eventType",
  "occurredAt",
  "receivedAt",
  "producer",
  "correlationId",
  "actorType",
  "actorId",
  "subjectType",
  "subjectId",
  "data",
  /**
   * The break-glass justification (Addendum A §A2.3 point 3). Admitted here
   * deliberately and only here: it is free text a human typed, it is the whole
   * reason a break-glass access can be judged after the fact, and it lives in a
   * column rather than in `data` precisely so this allowlist -- not a denylist
   * someone might rename their way past -- is what decides it can be shown.
   * Null on every row that is not a break-glass access.
   */
  "justification",
] as const;

export type AuditViewField = (typeof AUDIT_VIEW_FIELDS)[number];

export type AuditViewRow = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  receivedAt: string;
  producer: string;
  correlationId: string;
  actorType: string | null;
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
  justification: string | null;
};

/** Anything the store can hand us. Deliberately wide: the allowlist is the filter. */
export type AuditSourceRow = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `data` minus every key the analytics export would strip. */
export function redactViewData(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_DATA_KEYS.has(key.toLowerCase())) continue;
    safe[key] = entry;
  }
  return safe;
}

/**
 * Build a viewer row from a stored row.
 *
 * Constructed field by field rather than by spreading and deleting: a spread
 * would carry anything new by default and rely on someone remembering to remove
 * it. This way the allowlist is the only way in.
 */
export function toAuditViewRow(row: AuditSourceRow): AuditViewRow {
  return {
    eventId: text(row["eventId"]),
    eventType: text(row["eventType"]),
    occurredAt: text(row["occurredAt"]),
    receivedAt:
      row["receivedAt"] instanceof Date ? row["receivedAt"].toISOString() : text(row["receivedAt"]),
    producer: text(row["producer"]),
    correlationId: text(row["correlationId"]),
    actorType: nullableText(row["actorType"]),
    actorId: nullableText(row["actorId"]),
    subjectType: text(row["subjectType"]),
    subjectId: text(row["subjectId"]),
    data: redactViewData(row["data"]),
    justification: nullableText(row["justification"]),
  };
}

/** The four filters §A2.4 names. All optional; all narrowing. */
export type AuditQuery = {
  actorId?: string | undefined;
  /** The entity kind an action was about, e.g. `user`, `organization`. */
  subjectType?: string | undefined;
  /** The action, i.e. the event type. */
  eventType?: string | undefined;
  /** ISO-8601, inclusive. */
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
};

// --- CSV export ------------------------------------------------------------

function csvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // A leading =, +, - or @ makes a spreadsheet treat the cell as a formula. An
  // audit export is opened in a spreadsheet by definition, so neutralise it.
  const guarded = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Serialize viewer rows to CSV.
 *
 * Uses the same `AUDIT_VIEW_FIELDS` allowlist as the screen, so the file cannot
 * contain a column the viewer would not show. The forbidden-field test asserts
 * exactly that, over rows built to carry every forbidden key.
 */
export function toCsv(rows: ReadonlyArray<AuditViewRow>): string {
  const header = AUDIT_VIEW_FIELDS.join(",");
  const lines = rows.map((row) =>
    AUDIT_VIEW_FIELDS.map((field) => csvCell((row as Record<string, unknown>)[field])).join(","),
  );
  return [header, ...lines].join("\n");
}
