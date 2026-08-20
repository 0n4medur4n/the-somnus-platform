import type { EventEnvelope } from "@somnus/api-contracts";
import type { AuditStore } from "./db/repositories/index.js";

export type RecordOutcome = "recorded" | "deduped";

export type RecordResult = {
  outcome: RecordOutcome;
  id: string;
};

/**
 * The Audit module's public interface (build plan ADR 0010): the ONLY way anything
 * reaches the module. It normalizes an audit event envelope (§17) into a bounded
 * audit record and persists it, deduped by event id. It stores provenance, not a
 * copy of any service's data, and never persists secrets/health/free-text (the
 * envelope contract already excludes them).
 */
export class AuditService {
  constructor(private readonly store: AuditStore) {}

  async record(event: EventEnvelope): Promise<RecordResult> {
    const existing = await this.store.findByEventId(event.eventId);
    if (existing) {
      return { outcome: "deduped", id: existing.id };
    }

    const id = await this.store.create({
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
    });
    return { outcome: "recorded", id };
  }
}
