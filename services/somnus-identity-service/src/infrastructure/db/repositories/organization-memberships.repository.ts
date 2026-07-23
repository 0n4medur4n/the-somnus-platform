import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { organizationMemberships } from "../schema/index.js";
import type { OrgScope } from "../tenant-scope.js";

export type NewMembership = OrgScope & { userId: UUIDv7; invitedBy?: UUIDv7 };
export type MembershipScope = OrgScope & { membershipId: UUIDv7 };

/**
 * The canonical example from build plan §8:
 *   findMembership({ organizationId, membershipId });   // correct
 *   findMembershipById(membershipId);                    // forbidden
 * There is no `findByIdOnly` method here on purpose.
 */
export class OrganizationMembershipsRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewMembership): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(organizationMemberships).values({
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      invitedBy: input.invitedBy,
    });
    return id;
  }

  async findMembership(scope: MembershipScope) {
    const rows = await this.db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, scope.organizationId),
          eq(organizationMemberships.id, scope.membershipId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByOrgAndUser(scope: OrgScope & { userId: UUIDv7 }) {
    const rows = await this.db
      .select()
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, scope.organizationId),
          eq(organizationMemberships.userId, scope.userId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listMembers(scope: OrgScope) {
    return this.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.organizationId, scope.organizationId));
  }

  async setStatus(
    scope: MembershipScope,
    status: (typeof organizationMemberships.status.enumValues)[number],
  ): Promise<void> {
    await this.db
      .update(organizationMemberships)
      .set({ status })
      .where(
        and(
          eq(organizationMemberships.organizationId, scope.organizationId),
          eq(organizationMemberships.id, scope.membershipId),
        ),
      );
  }
}
