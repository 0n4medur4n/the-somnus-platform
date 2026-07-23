import { mysqlEnum, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

export const organizations = mysqlTable("organizations", {
  id: id(),
  name: varchar("name", { length: 200 }).notNull(),
  status: mysqlEnum("status", ["active", "suspended"]).notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const organizationLocations = mysqlTable("organization_locations", {
  id: id(),
  organizationId: uuidRef("organization_id").notNull(),
  name: varchar("name", { length: 200 }).notNull(),
  address: varchar("address", { length: 500 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const organizationMemberships = mysqlTable(
  "organization_memberships",
  {
    id: id(),
    organizationId: uuidRef("organization_id").notNull(),
    userId: uuidRef("user_id").notNull(),
    status: mysqlEnum("status", ["active", "inactive", "removed"]).notNull().default("active"),
    invitedBy: uuidRef("invited_by"),
    joinedAt: timestamp("joined_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("organization_memberships_org_user_idx").on(table.organizationId, table.userId),
  ],
);

export const organizationInvitations = mysqlTable("organization_invitations", {
  id: id(),
  organizationId: uuidRef("organization_id").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  roleId: uuidRef("role_id"),
  // Single-use per build plan §20 Checkpoint 6.3: the token is
  // consumed (status -> accepted) on first use, never reusable.
  token: varchar("token", { length: 128 }).notNull().unique(),
  status: mysqlEnum("status", ["pending", "accepted", "revoked", "expired"])
    .notNull()
    .default("pending"),
  invitedBy: uuidRef("invited_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
