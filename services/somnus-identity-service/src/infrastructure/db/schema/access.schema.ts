import { mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/**
 * Build plan §11: a professional may access an individual's shared
 * data only via an explicit, unexpired, unrevoked grant. subjectUserId
 * (the individual being accessed) is the tenant scope for this table
 * -- every lookup is "grants ON this person", never a bare grant id.
 */
export const accessGrants = mysqlTable("access_grants", {
  id: id(),
  professionalUserId: uuidRef("professional_user_id").notNull(),
  subjectUserId: uuidRef("subject_user_id").notNull(),
  organizationId: uuidRef("organization_id"),
  grantedBy: uuidRef("granted_by").notNull(),
  scope: varchar("scope", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["active", "revoked", "expired"]).notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const accountStatusHistory = mysqlTable("account_status_history", {
  id: id(),
  userId: uuidRef("user_id").notNull(),
  previousStatus: varchar("previous_status", { length: 32 }).notNull(),
  newStatus: varchar("new_status", { length: 32 }).notNull(),
  reason: varchar("reason", { length: 500 }),
  changedBy: uuidRef("changed_by"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
});

/** Session-revocation metadata (build plan §12); actual Firebase session state lives with edge-api (Phase 8). */
export const sessionRevocations = mysqlTable("session_revocations", {
  id: id(),
  userId: uuidRef("user_id").notNull(),
  revokedAt: timestamp("revoked_at").notNull().defaultNow(),
  reason: varchar("reason", { length: 200 }),
});

export const deletionRequests = mysqlTable("deletion_requests", {
  id: id(),
  userId: uuidRef("user_id").notNull(),
  status: mysqlEnum("status", ["pending", "completed", "cancelled"]).notNull().default("pending"),
  requestedAt: timestamp("requested_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});
