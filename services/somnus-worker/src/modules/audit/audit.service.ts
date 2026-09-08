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
      }),
    );
    return projectDashboards(exported, { truncated: rows.length >= DASHBOARD_ROW_CAP });
  }

  async record(event: EventEnvelope): Promise<RecordResult> {
    const existing = await this.store.findByEventId(event.eventId);
    if (existing) {
      return { outcome: "deduped", id: existing.id };
    }

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
      data: event.data,
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
