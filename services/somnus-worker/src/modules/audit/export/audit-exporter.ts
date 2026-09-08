import { ANALYTICS_EVENT_DATA_SCHEMAS, isAnalyticsEventType } from "@somnus/api-contracts";
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

/**
 * Two regimes, deliberately.
 *
 * For an **analytics event** (Addendum A Checkpoint 14.3) the payload is parsed
 * with its registered `.strict()` contract: an allowlist. Nothing that is not a
 * declared field can survive, whatever it is called -- which is the property a
 * denylist cannot give, since it only catches names someone thought of. A
 * payload that fails the contract exports as `{}` rather than half-trusted:
 * these events feed dashboards, and a malformed one is worth losing.
 *
 * For **every other event type** the original denylist still applies as defence
 * in depth against a misbehaving producer.
 */
function redactData(eventType: string, data: Record<string, unknown>): Record<string, unknown> {
  if (isAnalyticsEventType(eventType)) {
    const parsed = ANALYTICS_EVENT_DATA_SCHEMAS[eventType].safeParse(data);
    return parsed.success ? (parsed.data as Record<string, unknown>) : {};
  }

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
    data: redactData(record.eventType, record.data),
  };
}
