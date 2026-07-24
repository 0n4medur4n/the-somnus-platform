import { json, mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { consentPurposeKeys } from "./consent-purposes.schema.js";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/**
 * Append-only. `data` never carries passwords, tokens, cookies, or
 * health data (build plan §19/§21) -- callers are responsible for
 * redacting before writing.
 */
export const consentAuditEvents = mysqlTable("consent_audit_events", {
  id: id(),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  userId: uuidRef("user_id"),
  purposeKey: mysqlEnum("purpose_key", consentPurposeKeys),
  data: json("data"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});
