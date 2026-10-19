import { type StaffInvitationRoleKey, UUIDv7 } from "@somnus/api-contracts";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "../db.client.js";
import { staffInvitations } from "../schema/index.js";

export type StaffInvitationRow = typeof staffInvitations.$inferSelect;

export type NewStaffInvitation = {
  email: string;
  firstName: string;
  lastName: string;
  roleKey: StaffInvitationRoleKey;
  locale: "es" | "en" | "ca" | "fr";
  invitedBy: UUIDv7;
  expiresAt: Date;
};

/**
 * Staff invitations (owner decision 2026-10-18). Not tenant data: an invitation
 * belongs to the platform's staff, and every caller is either an admin holding
 * `admin_roles_assign` or the invited person looking up their OWN verified
 * address.
 */
export class StaffInvitationsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Creates the invitation, revoking any pending one for the same address
   * first, so an address never has two live invitations with different roles.
   */
  async replacePending(input: NewStaffInvitation): Promise<StaffInvitationRow> {
    const id = UUIDv7();
    await this.db.transaction(async (tx) => {
      await tx
        .update(staffInvitations)
        .set({ status: "revoked" })
        .where(
          and(eq(staffInvitations.email, input.email), eq(staffInvitations.status, "pending")),
        );
      await tx.insert(staffInvitations).values({ id, ...input });
    });
    const row = await this.findById(id);
    if (!row) throw new Error("staff invitation vanished after insert");
    return row;
  }

  async findById(id: string): Promise<StaffInvitationRow | null> {
    const rows = await this.db
      .select()
      .from(staffInvitations)
      .where(eq(staffInvitations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Newest first; bounded so the console can never page the whole table. */
  async listRecent(limit: number): Promise<StaffInvitationRow[]> {
    return this.db
      .select()
      .from(staffInvitations)
      .orderBy(desc(staffInvitations.createdAt))
      .limit(limit);
  }

  /** The usable invitation for an address: pending and not yet expired. */
  async findUsableByEmail(email: string, now: Date): Promise<StaffInvitationRow | null> {
    const rows = await this.db
      .select()
      .from(staffInvitations)
      .where(
        and(
          eq(staffInvitations.email, email),
          eq(staffInvitations.status, "pending"),
          gt(staffInvitations.expiresAt, now),
        ),
      )
      .orderBy(desc(staffInvitations.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Pending -> revoked. False when it was no longer pending. */
  async revoke(id: string): Promise<boolean> {
    const result = await this.db
      .update(staffInvitations)
      .set({ status: "revoked" })
      .where(and(eq(staffInvitations.id, id), eq(staffInvitations.status, "pending")));
    return (result[0].affectedRows ?? 0) > 0;
  }

  /**
   * Pending -> accepted, in the WHERE clause: two concurrent accepts cannot
   * both win, so one invitation creates at most one account.
   */
  async markAccepted(id: string, userId: UUIDv7, at: Date): Promise<boolean> {
    const result = await this.db
      .update(staffInvitations)
      .set({ status: "accepted", acceptedUserId: userId, acceptedAt: at })
      .where(and(eq(staffInvitations.id, id), eq(staffInvitations.status, "pending")));
    return (result[0].affectedRows ?? 0) > 0;
  }
}
