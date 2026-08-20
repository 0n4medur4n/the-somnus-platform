import { Logger } from "@nestjs/common";
import type { EventEnvelope } from "@somnus/api-contracts";
import type { AuditRecordInput, AuditStore } from "./db/repositories/index.js";
import { type AuditExporter, redactForExport } from "./export/audit-exporter.js";

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
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly store: AuditStore,
    private readonly exporter: AuditExporter,
  ) {}

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
