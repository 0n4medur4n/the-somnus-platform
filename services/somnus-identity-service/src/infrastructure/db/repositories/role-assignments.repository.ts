import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { roleAssignments } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

export type NewRoleAssignment = UserScope & {
  roleId: UUIDv7;
  organizationId?: UUIDv7;
  assignedBy: UUIDv7;
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
