import { Injectable } from "@nestjs/common";
import type { AuthorizationCheckRequest, AuthorizationCheckResponse } from "@somnus/api-contracts";
import { UUIDv7 } from "@somnus/api-contracts";
// biome-ignore lint/style/useImportType: constructor-injected -- Nest reflects design:paramtypes at runtime to resolve these as DI tokens; a type-only import erases the reference and breaks injection.
import {
  AccessGrantsRepository,
  OrganizationMembershipsRepository,
  ProfessionalProfilesRepository,
  RoleAssignmentsRepository,
  RolesRepository,
  UsersRepository,
} from "../../infrastructure/db/repositories/index.js";
import { evaluateAccess } from "./authorization-policy.js";

/**
 * Impure shell around the pure policy (authorization-policy.ts):
 * resolves every fact the policy needs from the Checkpoint 6.1
 * repositories, then hands off to evaluateAccess. No authorization
 * *logic* lives here -- only fact-gathering and response shaping.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly users: UsersRepository,
    private readonly roleAssignments: RoleAssignmentsRepository,
    private readonly roles: RolesRepository,
    private readonly memberships: OrganizationMembershipsRepository,
    private readonly professionalProfiles: ProfessionalProfilesRepository,
    private readonly accessGrants: AccessGrantsRepository,
  ) {}

  async check(request: AuthorizationCheckRequest): Promise<AuthorizationCheckResponse> {
    const actor = await this.users.findById(request.actorUserId);
    // An actor that does not exist is treated the same as "deleted":
    // the policy denies with DENIED_ACTOR_ACCOUNT_INACTIVE either way.
    const actorStatus = actor?.status ?? "deleted";

    const assignments = await this.roleAssignments.listActiveForUser({
      userId: request.actorUserId,
    });
    const roleRows =
      assignments.length > 0
        ? await this.roles.findManyByIds(assignments.map((a) => a.roleId))
        : [];
    const actorRoleKeys = roleRows.map((r) => r.key);

    let actorMembership:
      | { organizationId: string; status: "active" | "inactive" | "removed" }
      | undefined;
    if (request.organizationId) {
      const membership = await this.memberships.findByOrgAndUser({
        organizationId: request.organizationId,
        userId: request.actorUserId,
      });
      if (membership) {
        actorMembership = { organizationId: membership.organizationId, status: membership.status };
      }
    }

    let verificationStatus: "pending" | "verified" | "rejected" | undefined;
    if (actorRoleKeys.includes("professional")) {
      const profile = await this.professionalProfiles.findByUser({ userId: request.actorUserId });
      verificationStatus = profile?.verificationStatus;
    }

    let accessGrant:
      | {
          id: string;
          organizationId?: string;
          status: "active" | "revoked" | "expired";
          expiresAt?: Date;
        }
      | undefined;
    if (request.action === "read_clinical_data") {
      const grant = await this.accessGrants.findLatestGrant({
        userId: request.subjectUserId,
        professionalUserId: request.actorUserId,
      });
      if (grant) {
        accessGrant = {
          id: grant.id,
          status: grant.status,
          ...(grant.organizationId ? { organizationId: grant.organizationId } : {}),
          ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
        };
      }
    }

    const decision = evaluateAccess({
      now: new Date(),
      actorUserId: request.actorUserId,
      actorStatus,
      actorRoleKeys,
      subjectUserId: request.subjectUserId,
      action: request.action,
      ...(request.organizationId ? { organizationId: request.organizationId } : {}),
      ...(actorMembership ? { actorMembership } : {}),
      ...(verificationStatus ? { actorProfessionalVerificationStatus: verificationStatus } : {}),
      ...(accessGrant ? { accessGrant } : {}),
      // Build plan Phase 7 (Consent module) supplies the real value
      // through its public interface; no consent data exists yet.
      consentWithdrawn: false,
    });

    return {
      allowed: decision.allowed,
      decisionId: UUIDv7(),
      reasonCode: decision.reasonCode,
      ...(decision.constraints ? { constraints: decision.constraints } : {}),
    };
  }
}
