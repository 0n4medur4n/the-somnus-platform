import { json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/**
 * Append-only. `data` never carries passwords, tokens, cookies, or
 * health data (build plan §19/§21 non-negotiable rule) -- callers are
 * responsible for redacting before writing.
 */
export const identityAuditEvents = mysqlTable("identity_audit_events", {
  id: id(),
  eventType: varchar("event_type", { length: 120 }).notNull(),
  actorUserId: uuidRef("actor_user_id"),
  subjectUserId: uuidRef("subject_user_id"),
  organizationId: uuidRef("organization_id"),
  data: json("data"),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});
