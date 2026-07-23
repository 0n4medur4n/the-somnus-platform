import {
  boolean,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const id = () => varchar("id", { length: 36 }).primaryKey();
const uuidRef = (name: string) => varchar(name, { length: 36 });

/** Build plan §11: external + internal roles. Professional specialty is profile data, never a role. */
export const roleKeys = [
  "individual_user",
  "professional",
  "organization_owner",
  "organization_admin",
  "professional_manager",
  "clinical_supervisor",
  "support_agent",
  "professional_verifier",
  "clinical_governance_reviewer",
  "platform_admin",
  "platform_super_admin",
] as const;

export const roles = mysqlTable("roles", {
  id: id(),
  key: mysqlEnum("key", roleKeys).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  scope: mysqlEnum("scope", ["platform", "organization"]).notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const permissions = mysqlTable("permissions", {
  id: id(),
  key: varchar("key", { length: 120 }).notNull().unique(),
  description: varchar("description", { length: 500 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const rolePermissions = mysqlTable(
  "role_permissions",
  {
    id: id(),
    roleId: uuidRef("role_id").notNull(),
    permissionId: uuidRef("permission_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("role_permissions_role_permission_idx").on(table.roleId, table.permissionId),
  ],
);

/**
 * Tenant-scoped by userId always; organizationId is set for
 * organization-scope roles and null for platform-scope roles (build
 * plan §11). A role_assignment IS how a user gets a role -- there is
 * no "roleId" column on users.
 */
export const roleAssignments = mysqlTable("role_assignments", {
  id: id(),
  userId: uuidRef("user_id").notNull(),
  roleId: uuidRef("role_id").notNull(),
  organizationId: uuidRef("organization_id"),
  assignedBy: uuidRef("assigned_by").notNull(),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
