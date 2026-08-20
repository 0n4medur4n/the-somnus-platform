import { UUIDv7 } from "@somnus/api-contracts";
import { eq } from "drizzle-orm";
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
};

/**
 * The persistence surface AuditService depends on — an interface so the service is
 * unit-tested with a fake, no database. AuditRepository satisfies it structurally.
 */
export interface AuditStore {
  findByEventId(eventId: string): Promise<AuditRow | null>;
  create(input: AuditRecordInput): Promise<string>;
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
}
