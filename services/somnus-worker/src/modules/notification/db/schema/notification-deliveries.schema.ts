import { NOTIFICATION_TYPES, SUPPORTED_LOCALES } from "@somnus/api-contracts";
import { int, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * One row per notification the worker was asked to deliver (build plan §5.7).
 * `idempotency_key` is UNIQUE: the same Cloud Task delivered twice is recorded —
 * and thus processed — once. `last_error` and every other column carry only
 * operational data; NO health details, assessment content, or L-level ever
 * touches this table (§3.7).
 */
export const DELIVERY_STATUSES = ["pending", "sent", "failed", "dead_letter"] as const;

export const notificationDeliveries = mysqlTable("notification_deliveries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull().unique(),
  type: mysqlEnum("type", NOTIFICATION_TYPES).notNull(),
  recipient: varchar("recipient", { length: 320 }).notNull(),
  locale: mysqlEnum("locale", SUPPORTED_LOCALES).notNull(),
  status: mysqlEnum("status", DELIVERY_STATUSES).notNull().default("pending"),
  attempts: int("attempts").notNull().default(0),
  lastError: varchar("last_error", { length: 500 }),
  providerMessageId: varchar("provider_message_id", { length: 200 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
