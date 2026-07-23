import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { permissions, type roleKeys, rolePermissions, roles } from "../schema/index.js";

export type RoleKey = (typeof roleKeys)[number];

/**
 * Platform reference data: roles/permissions are not owned by any
 * single user or organization (build plan §11 defines a fixed role
 * catalog), so these are not tenant-scoped -- looking up "the
 * organization_admin role" by its key is not tenant data access.
 */
export class RolesRepository {
  constructor(private readonly db: Db) {}

  async seedRole(input: {
    key: RoleKey;
    name: string;
    scope: "platform" | "organization";
    isInternal: boolean;
  }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(roles).values({ id, ...input });
    return id;
  }

  async findByKey(key: RoleKey) {
    const rows = await this.db.select().from(roles).where(eq(roles.key, key)).limit(1);
    return rows[0] ?? null;
  }

  /** Platform reference data, not tenant-scoped -- see class doc. Used to resolve role_assignments.roleId -> roleKey. */
  async findManyByIds(ids: ReadonlyArray<UUIDv7>) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(roles)
      .where(inArray(roles.id, [...ids]));
  }

  async seedPermission(input: { key: string; description: string }): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(permissions).values({ id, ...input });
    return id;
  }

  async findPermissionByKey(key: string) {
    const rows = await this.db.select().from(permissions).where(eq(permissions.key, key)).limit(1);
    return rows[0] ?? null;
  }

  async grantPermission(roleId: UUIDv7, permissionId: UUIDv7): Promise<void> {
    await this.db.insert(rolePermissions).values({ id: UUIDv7(), roleId, permissionId });
  }

  async listPermissionsForRole(roleId: UUIDv7) {
    return this.db
      .select({ permission: permissions })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(eq(rolePermissions.roleId, roleId));
  }

  async hasPermission(roleId: UUIDv7, permissionId: UUIDv7): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, permissionId)),
      )
      .limit(1);
    return rows.length > 0;
  }
}
