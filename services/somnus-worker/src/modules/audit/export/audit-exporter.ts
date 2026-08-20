import type { AuditRecordInput } from "../db/repositories/index.js";

/**
 * The privacy-safe row exported for analytics (build plan §5.7 / §21). It carries
 * provenance TYPES and a redacted `data`, but NOT the actor/subject IDs (which can
 * be PII) and NOT any forbidden field. The full record stays in `somnus_audit`;
 * only this reduced, redacted shape leaves the service.
 */
export type AuditExportRow = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  actorType: string | null;
  subjectType: string;
  data: Record<string, unknown>;
};

/** The export sink (BigQuery in prod, mocked in tests). Never called without config. */
export interface AuditExporter {
  export(row: AuditExportRow): Promise<void>;
}

/**
 * Keys that must never leave the service in an analytics export (build plan §17:
 * the envelope already forbids these, but redaction is defence in depth in case a
 * producer misbehaves). Matched case-insensitively against `data`'s top-level keys.
 */
export const FORBIDDEN_DATA_KEYS: ReadonlySet<string> = new Set([
  "password",
  "token",
  "cookie",
  "secret",
  "authorization",
  "email",
  "phone",
  "answers",
  "answer",
  "reportbody",
  "report_body",
  "freetext",
  "free_text",
  "healthdata",
  "health_data",
  "ssn",
  "dob",
]);

function redactData(data: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (FORBIDDEN_DATA_KEYS.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Reduce a normalized audit record to a privacy-safe export row: drop the
 * actor/subject IDs (potential PII) and every forbidden `data` key.
 */
export function redactForExport(record: AuditRecordInput): AuditExportRow {
  return {
    eventId: record.eventId,
    eventType: record.eventType,
    occurredAt: record.occurredAt,
    producer: record.producer,
    correlationId: record.correlationId,
    actorType: record.actorType,
    subjectType: record.subjectType,
    data: redactData(record.data),
  };
}
