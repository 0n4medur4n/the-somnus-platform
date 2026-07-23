import { randomBytes } from "node:crypto";
import { UUIDv7 } from "@somnus/api-contracts";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { organizationInvitations } from "../schema/index.js";
import type { OrgScope } from "../tenant-scope.js";

export type NewInvitation = OrgScope & {
  email: string;
  roleId?: UUIDv7;
  invitedBy: UUIDv7;
  expiresAt: Date;
};

export type InvitationScope = OrgScope & { invitationId: UUIDv7 };

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export class OrganizationInvitationsRepository {
  constructor(private readonly db: Db) {}

  async create(input: NewInvitation): Promise<{ id: UUIDv7; token: string }> {
    const id = UUIDv7();
    const token = generateToken();
    await this.db.insert(organizationInvitations).values({
      id,
      organizationId: input.organizationId,
      email: input.email,
      roleId: input.roleId,
      token,
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
    });
    return { id, token };
  }

  async findByOrgAndId(scope: InvitationScope) {
    const rows = await this.db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, scope.organizationId),
          eq(organizationInvitations.id, scope.invitationId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Token lookup is deliberately NOT org-scoped: the accept flow only
   * has the token (from an emailed link), not the org id yet. Tokens
   * are single-use (build plan §20 Checkpoint 6.3) -- `accept()` below
   * only succeeds from `pending` status, so a reused token is a no-op.
   */
  async findByToken(token: string) {
    const rows = await this.db
      .select()
      .from(organizationInvitations)
      .where(eq(organizationInvitations.token, token))
      .limit(1);
    return rows[0] ?? null;
  }

  async accept(token: string): Promise<boolean> {
    const result = await this.db
      .update(organizationInvitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(organizationInvitations.token, token),
          eq(organizationInvitations.status, "pending"),
        ),
      );
    return (result[0].affectedRows ?? 0) > 0;
  }

  async listPending(scope: OrgScope) {
    return this.db
      .select()
      .from(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, scope.organizationId),
          eq(organizationInvitations.status, "pending"),
        ),
      );
  }
}
