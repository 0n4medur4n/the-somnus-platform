import { UUIDv7 } from "@somnus/api-contracts";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { AuditQuery } from "../../export/audit-view.js";
import type { AuditDb } from "../audit-db.client.js";
import { auditRecords } from "../schema/index.js";

export type AuditRow = typeof auditRecords.$inferSelect;

export type AuditRecordInput = {
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  actorType: string | null;
  actorId: string | null;
  subjectType: string;
  subjectId: string;
  data: Record<string, unknown>;
  /**
   * The admin's written reason, for the one event type that carries one
   * (Addendum A §A2.3 / Checkpoint 15.5). Null for everything else.
   *
   * Outside `data` deliberately: the analytics export row is built from a fixed
   * field list that has no `justification`, so free text a human typed cannot
   * reach BigQuery by any route (build plan §9).
   */
  justification: string | null;
};

/**
 * The persistence surface AuditService depends on — an interface so the service is
 * unit-tested with a fake, no database. AuditRepository satisfies it structurally.
 */
export interface AuditStore {
  findByEventId(eventId: string): Promise<AuditRow | null>;
  create(input: AuditRecordInput): Promise<string>;
  /** The audit log viewer's read side (Addendum A §A2.4 / Checkpoint 15.4). */
  query(filter: AuditQuery): Promise<AuditRow[]>;
  /** The dashboards' read side: a bounded window, oldest first. */
  listWindow(input: {
    from?: string | undefined;
    to?: string | undefined;
    cap: number;
  }): Promise<AuditRow[]>;
}

export class AuditRepository implements AuditStore {
  constructor(private readonly db: AuditDb) {}

  async findByEventId(eventId: string): Promise<AuditRow | null> {
    const rows = await this.db
      .select()
      .from(auditRecords)
      .where(eq(auditRecords.eventId, eventId))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: AuditRecordInput): Promise<string> {
    const id = UUIDv7();
    await this.db.insert(auditRecords).values({ id, ...input });
    return id;
  }

  /**
   * The four filters §A2.4 names: actor, entity, action, date range. Each is
   * optional and each only ever NARROWS -- there is no filter value that widens
   * the result beyond the caller's page size, so a malformed request returns
   * less, never more.
   *
   * Ordered newest first, which is the only order an audit log is read in, and
   * bounded by an explicit limit so the viewer cannot ask for the whole store.
   */
  async query(filter: AuditQuery): Promise<AuditRow[]> {
    const conditions: SQL[] = [];
    if (filter.actorId) conditions.push(eq(auditRecords.actorId, filter.actorId));
    if (filter.subjectType) conditions.push(eq(auditRecords.subjectType, filter.subjectType));
    if (filter.eventType) conditions.push(eq(auditRecords.eventType, filter.eventType));
    // `occurred_at` is an ISO-8601 string column, so lexicographic comparison is
    // chronological for any two same-precision UTC stamps.
    if (filter.from) conditions.push(gte(auditRecords.occurredAt, filter.from));
    if (filter.to) conditions.push(lte(auditRecords.occurredAt, filter.to));

    const where = conditions.length === 0 ? undefined : and(...conditions);
    return this.db
      .select()
      .from(auditRecords)
      .where(where)
      .orderBy(desc(auditRecords.occurredAt))
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
  }

  /**
   * The rows a dashboard aggregates, oldest first and explicitly bounded.
   *
   * The cap exists because an unbounded scan of an append-only audit store is a
   * production incident waiting for enough traffic. The caller is told when the
   * cap was reached (`truncated`) rather than being handed a partial count that
   * looks like a total.
   */
  async listWindow(input: {
    from?: string | undefined;
    to?: string | undefined;
    cap: number;
  }): Promise<AuditRow[]> {
    const conditions: SQL[] = [];
    if (input.from) conditions.push(gte(auditRecords.occurredAt, input.from));
    if (input.to) conditions.push(lte(auditRecords.occurredAt, input.to));
    const where = conditions.length === 0 ? undefined : and(...conditions);
    return this.db
      .select()
      .from(auditRecords)
      .where(where)
      .orderBy(auditRecords.occurredAt)
      .limit(input.cap);
  }
}
