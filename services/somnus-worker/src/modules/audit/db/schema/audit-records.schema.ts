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
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});
