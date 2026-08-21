import type { UUIDv7 } from "@somnus/api-contracts";
import { eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db.client.js";
import {
  accessGrants,
  accountStatusHistory,
  deletionRequests,
  individualProfiles,
  organizationInvitations,
  organizationMemberships,
  professionalCredentials,
  professionalProfiles,
  professionalVerificationCases,
  roleAssignments,
  sessionRevocations,
  userIdentities,
  users,
} from "../schema/index.js";

/**
 * Right-to-erasure (build plan §21 / Checkpoint 13.2): deletes all of a user's
 * personal identity data in one transaction. It does NOT delete
 * `identity_audit_events` (the audit trail is retained, §21) nor `organizations`
 * (shared entities a departing user does not own away). Consent lives in its own
 * isolated database and is erased separately via `ConsentService.eraseUser`.
 */
export class AccountDeletionRepository {
  constructor(private readonly db: Db) {}

  /**
   * Scoped to the data subject's `userId`, deliberately NOT org-scoped
   * (tenant-scope-guard exemption): right-to-erasure spans every organization
   * the user ever belonged to, so there is no single organization scope to pass
   * -- the user id *is* the scope. This is the same class of reviewed exception
   * as the invitation-token lookups (build plan §8 allows an organization *or a
   * user* scope).
   */
  async eraseIdentityData(userId: UUIDv7): Promise<void> {
    await this.db.transaction(async (tx) => {
      const profiles = await tx
        .select({ id: professionalProfiles.id })
        .from(professionalProfiles)
        .where(eq(professionalProfiles.userId, userId));
      const profileIds = profiles.map((row) => row.id);
      if (profileIds.length > 0) {
        await tx
          .delete(professionalCredentials)
          .where(inArray(professionalCredentials.professionalProfileId, profileIds));
        await tx
          .delete(professionalVerificationCases)
          .where(inArray(professionalVerificationCases.professionalProfileId, profileIds));
      }

      await tx
        .delete(accessGrants)
        .where(
          or(eq(accessGrants.subjectUserId, userId), eq(accessGrants.professionalUserId, userId)),
        );
      await tx.delete(organizationInvitations).where(eq(organizationInvitations.invitedBy, userId));
      await tx.delete(organizationMemberships).where(eq(organizationMemberships.userId, userId));
      await tx.delete(roleAssignments).where(eq(roleAssignments.userId, userId));
      await tx.delete(professionalProfiles).where(eq(professionalProfiles.userId, userId));
      await tx.delete(individualProfiles).where(eq(individualProfiles.userId, userId));
      await tx.delete(userIdentities).where(eq(userIdentities.userId, userId));
      await tx.delete(sessionRevocations).where(eq(sessionRevocations.userId, userId));
      await tx.delete(accountStatusHistory).where(eq(accountStatusHistory.userId, userId));
      await tx.delete(deletionRequests).where(eq(deletionRequests.userId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });
  }
}
