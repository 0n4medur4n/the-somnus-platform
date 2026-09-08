import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { roleAssignments } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

export type NewRoleAssignment = UserScope & {
  roleId: UUIDv7;
  organizationId?: UUIDv7;
  /**
   * The admin who granted it. `null` ONLY for the platform bootstrap that
   * creates the first `platform_super_admin` (Addendum A §A5.4): there is no
   * prior admin to attribute it to, and recording the grantee as their own
   * grantor would be indistinguishable from a self-assignment attack.
   */
  assignedBy: UUIDv7 | null;
};

/**
 * Always UserScope: a role assignment belongs to the user it was
 * assigned to. organizationId narrows further for org-scoped roles
 * but is never the sole scope (build plan §11: role_assignments has
 * no meaning detached from the user who holds the role).
 */
export class RoleAssignmentsRepository {
  constructor(private readonly db: Db) {}

  async assign(input: NewRoleAssignment): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(roleAssignments).values({
      id,
      userId: input.userId,
      roleId: input.roleId,
      organizationId: input.organizationId,
      assignedBy: input.assignedBy,
    });
    return id;
  }

  /**
   * Does ANYONE hold this role right now? The bootstrap uses it as its own
   * kill switch: the first `platform_super_admin` can be created once, and
   * every later attempt is refused, so the script is not a standing backdoor
   * left in the repository (Addendum A §A5.4).
   *
   * Deliberately not UserScope: the question is about the role across the
   * whole platform, which is exactly what makes it safe to answer.
   */
  async hasAnyActiveHolder(roleId: UUIDv7): Promise<boolean> {
    const rows = await this.db
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.roleId, roleId), isNull(roleAssignments.revokedAt)))
      .limit(1);
    return rows.length > 0;
  }

  async listActiveForUser(scope: UserScope) {
    return this.db
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, scope.userId), isNull(roleAssignments.revokedAt)));
  }

  async listActiveForUserInOrganization(scope: UserScope & { organizationId: UUIDv7 }) {
    return this.db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, scope.userId),
          eq(roleAssignments.organizationId, scope.organizationId),
          isNull(roleAssignments.revokedAt),
        ),
      );
  }

  async revoke(scope: UserScope & { assignmentId: UUIDv7 }): Promise<void> {
    await this.db
      .update(roleAssignments)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(roleAssignments.userId, scope.userId), eq(roleAssignments.id, scope.assignmentId)),
      );
  }
}
