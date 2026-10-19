import { mysqlEnum, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const platformInvitations = mysqlTable("platform_invitations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  // NULL after use/revocation: the unique index serializes concurrent replacements.
  pendingEmail: varchar("pending_email", { length: 320 }).unique(),
  firstName: varchar("first_name", { length: 120 }).notNull(),
  lastName: varchar("last_name", { length: 120 }).notNull(),
  role: mysqlEnum("role", ["adult", "professional"]).notNull(),
  locale: mysqlEnum("locale", ["es", "en", "ca", "fr"]).notNull(),
  status: mysqlEnum("status", ["pending", "accepted", "revoked"]).notNull().default("pending"),
  invitedBy: varchar("invited_by", { length: 36 }).notNull(),
  preparedUserId: varchar("prepared_user_id", { length: 36 }),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
