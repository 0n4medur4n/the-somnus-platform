import { UUIDv7 } from "@somnus/api-contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { accessGrants } from "../schema/index.js";
import type { UserScope } from "../tenant-scope.js";

export type NewAccessGrant = UserScope & {
  professionalUserId: UUIDv7;
  organizationId?: UUIDv7;
  grantedBy: UUIDv7;
  scope: string;
  expiresAt?: Date;
};

/**
 * Scoped by subjectUserId (build plan §11: access to an individual's
 * data is granted per-individual). `scope` here (the UserScope
 * parameter) means "grants ON this person", matching the access-grant
 * concept itself -- never a bare grant-id lookup.
 */
export class AccessGrantsRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewAccessGrant): Promise<UUIDv7> {
    const id = UUIDv7();
    await this.db.insert(accessGrants).values({
      id,
      professionalUserId: input.professionalUserId,
      subjectUserId: input.userId,
      organizationId: input.organizationId,
      grantedBy: input.grantedBy,
      scope: input.scope,
      expiresAt: input.expiresAt,
    });
    return id;
  }

  async listActiveForSubject(scope: UserScope) {
    return this.db
      .select()
      .from(accessGrants)
      .where(and(eq(accessGrants.subjectUserId, scope.userId), eq(accessGrants.status, "active")));
  }

  async findActiveGrant(scope: UserScope & { professionalUserId: UUIDv7 }) {
    const rows = await this.db
      .select()
      .from(accessGrants)
      .where(
        and(
          eq(accessGrants.subjectUserId, scope.userId),
          eq(accessGrants.professionalUserId, scope.professionalUserId),
          eq(accessGrants.status, "active"),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Unlike findActiveGrant, this does not filter by status: the
   * authorization policy (src/domain/authorization) needs to tell
   * "never granted" (DENIED_ACCESS_GRANT_NOT_FOUND) apart from
   * "granted, then revoked or expired" (DENIED_ACCESS_GRANT_REVOKED /
   * _EXPIRED) -- findActiveGrant alone collapses all three into "not found".
   */
  async findLatestGrant(scope: UserScope & { professionalUserId: UUIDv7 }) {
    const rows = await this.db
      .select()
      .from(accessGrants)
      .where(
        and(
          eq(accessGrants.subjectUserId, scope.userId),
          eq(accessGrants.professionalUserId, scope.professionalUserId),
        ),
      )
      .orderBy(desc(accessGrants.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async revoke(scope: UserScope & { grantId: UUIDv7 }): Promise<void> {
    await this.db
      .update(accessGrants)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(and(eq(accessGrants.subjectUserId, scope.userId), eq(accessGrants.id, scope.grantId)));
  }
}
