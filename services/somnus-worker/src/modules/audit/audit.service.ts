import { Logger } from "@nestjs/common";
import type { EventEnvelope } from "@somnus/api-contracts";
import type { AuditRecordInput, AuditStore } from "./db/repositories/index.js";
import { type AuditExporter, redactForExport } from "./export/audit-exporter.js";
import { type AuditQuery, type AuditViewRow, toAuditViewRow } from "./export/audit-view.js";
import { type Dashboards, projectDashboards } from "./export/dashboards.js";

export type RecordOutcome = "recorded" | "deduped";

export type RecordResult = {
  outcome: RecordOutcome;
  id: string;
};

/**
 * The Audit module's public interface (build plan ADR 0010): the ONLY way anything
 * reaches the module. It normalizes an audit event envelope (§17) into a bounded
 * audit record and persists it, deduped by event id, then streams a REDACTED,
 * privacy-safe row to the analytics export. It stores provenance, not a copy of
 * any service's data, and never persists or exports secrets/health/free-text.
 */
/** Bounded so a dashboard can never scan an append-only store unbounded. */
const DASHBOARD_ROW_CAP = 5000;

export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly store: AuditStore,
    private readonly exporter: AuditExporter,
  ) {}

  /**
   * The audit log viewer's read side (Addendum A §A2.4 / Checkpoint 15.4).
   *
   * On the module's PUBLIC interface, because ADR 0010 makes this the only way
   * anything reaches the Audit module -- the console does not get a repository,
   * and edge-api does not get the database. What it gets back is already
   * projected through the viewer's allowlist, so a caller cannot receive a field
   * and then decide for itself whether to render it.
   */
  async query(filter: AuditQuery): Promise<AuditViewRow[]> {
    const rows = await this.store.query(filter);
    return rows.map((row) => toAuditViewRow(row as unknown as Record<string, unknown>));
  }

  /**
   * The statistics dashboards (Addendum A §A2.4 / Checkpoint 15.4).
   *
   * Computed over the rows AS THE EXPORT WOULD SEE THEM: each stored record goes
   * through `redactForExport` before the projection touches it, the same function
   * that produces the BigQuery rows. So the screen and the warehouse cannot
   * disagree, and no second export path was invented to make a dashboard
   * possible -- which is exactly the constraint this checkpoint was given.
   *
   * BigQuery is not read back. It is a sink here, and adding a read path to it
   * would be that second path.
   */
  async dashboards(
    input: { from?: string | undefined; to?: string | undefined } = {},
  ): Promise<Dashboards> {
    const rows = await this.store.listWindow({ ...input, cap: DASHBOARD_ROW_CAP });
    const exported = rows.map((row) =>
      redactForExport({
        eventId: row.eventId,
        eventType: row.eventType,
        occurredAt: row.occurredAt,
        producer: row.producer,
        correlationId: row.correlationId,
        actorType: row.actorType,
        actorId: row.actorId,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        data: row.data as Record<string, unknown>,
        // Handed over and then dropped: `redactForExport` builds a fixed shape
        // with no `justification` in it. Passing it here rather than nulling it
        // keeps that guarantee visible instead of relying on this call site.
        justification: row.justification,
      }),
    );
    return projectDashboards(exported, { truncated: rows.length >= DASHBOARD_ROW_CAP });
  }

  async record(event: EventEnvelope): Promise<RecordResult> {
    const existing = await this.store.findByEventId(event.eventId);
    if (existing) {
      return { outcome: "deduped", id: existing.id };
    }

    const { justification, data } = liftJustification(event.data);
    const input: AuditRecordInput = {
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      producer: event.producer,
      correlationId: event.correlationId,
      actorType: event.actor?.type ?? null,
      actorId: event.actor?.id ?? null,
      subjectType: event.subject.type,
      subjectId: event.subject.id,
      data,
      justification,
    };

    const id = await this.store.create(input);
    await this.exportSafely(input);
    return { outcome: "recorded", id };
  }

  /** Export failures never block ingest: the record is already persisted. */
  private async exportSafely(input: AuditRecordInput): Promise<void> {
    try {
      await this.exporter.export(redactForExport(input));
    } catch {
      this.logger.warn("audit analytics export failed; the record is persisted");
    }
  }
}

/** The one key an event payload may carry that must not stay in `data`. */
const JUSTIFICATION_KEY = "justification";

/**
 * Move a break-glass justification out of the event payload and into its own
 * field (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * The §17 envelope has one free-form slot, `data`, and §17 also says free text
 * does not belong in it. Break-glass needs both things to be true: the admin's
 * written reason has to be stored and shown in the audit viewer, and it must
 * never reach the analytics export. Lifting it here is what reconciles them --
 * after this, `data` holds no free text, and the export row's fixed shape has no
 * field the text could travel in.
 *
 * Applied to every event, not just break-glass. A producer that puts a
 * `justification` in a payload has written free text into `data` whatever it
 * called the action, and the same rule should catch it.
 */
export function liftJustification(payload: Record<string, unknown>): {
  justification: string | null;
  data: Record<string, unknown>;
} {
  const raw = payload[JUSTIFICATION_KEY];
  if (typeof raw !== "string") {
    // Not a string (or absent): nothing to lift. A non-string value under that
    // key is still removed, because whatever it is, it is not a justification
    // and it is not something `data` should be carrying under that name.
    if (!(JUSTIFICATION_KEY in payload)) return { justification: null, data: payload };
    const { [JUSTIFICATION_KEY]: _dropped, ...rest } = payload;
    return { justification: null, data: rest };
  }
  const { [JUSTIFICATION_KEY]: _lifted, ...rest } = payload;
  const trimmed = raw.trim();
  return { justification: trimmed.length > 0 ? trimmed.slice(0, 500) : null, data: rest };
}
