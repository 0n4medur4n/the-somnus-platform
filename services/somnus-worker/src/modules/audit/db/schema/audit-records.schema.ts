import { json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * One normalized audit record per audit event (build plan §5.7 / §17). Stores the
 * envelope's provenance (who/what/when/action) + a bounded `data` object. NOT a
 * copy of any service database. `event_id` is UNIQUE so a redelivered event is
 * recorded once. The envelope contract already forbids secrets/health/free-text;
 * the BigQuery export additionally redacts before it leaves the service.
 */
export const auditRecords = mysqlTable("audit_records", {
  id: varchar("id", { length: 36 }).primaryKey(),
  eventId: varchar("event_id", { length: 36 }).notNull().unique(),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  occurredAt: varchar("occurred_at", { length: 40 }).notNull(),
  producer: varchar("producer", { length: 120 }).notNull(),
  correlationId: varchar("correlation_id", { length: 64 }).notNull(),
  actorType: varchar("actor_type", { length: 64 }),
  actorId: varchar("actor_id", { length: 200 }),
  subjectType: varchar("subject_type", { length: 64 }).notNull(),
  subjectId: varchar("subject_id", { length: 200 }).notNull(),
  data: json("data").notNull(),
  /**
   * The admin's written reason, for the one event type that has one:
   * break-glass access to an individual's clinical record (Addendum A §A2.3 /
   * Checkpoint 15.5). Null for every other row.
   *
   * A column of its own rather than a key inside `data`, and the reason is the
   * whole privacy argument for it. §17 forbids free text in an event payload,
   * and the analytics export builds its row from a fixed field list that has no
   * `justification` in it -- so keeping the text here means it CANNOT reach
   * BigQuery, whatever anyone later adds to a denylist or forgets to. The audit
   * viewer reads it deliberately, through its own allowlist.
   */
  justification: varchar("justification", { length: 500 }),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});
