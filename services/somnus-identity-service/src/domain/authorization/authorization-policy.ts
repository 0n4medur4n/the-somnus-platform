import type {
  AuthorizationAction,
  AuthorizationConstraints,
  AuthorizationReasonCode,
  RoleKey,
  UUIDv7,
} from "@somnus/api-contracts";

/**
 * Pure authorization policy (build plan §20 Checkpoint 6.2 / §11).
 * Zero dependencies on NestJS, Drizzle, or HTTP -- same shape build
 * plan §20 Checkpoint 10.1 mandates for Morpheo's rule engine. All
 * facts (membership, verification, grant, consent) are resolved by
 * the caller (AuthorizationService, which queries the Checkpoint 6.1
 * repositories) and passed in already-evaluated; `now` is an explicit
 * input rather than read from the clock internally, so a test never
 * has to race real time to exercise an expiry path.
 */

export type ActorStatus = "active" | "suspended" | "deleted";
export type MembershipStatus = "active" | "inactive" | "removed";
export type VerificationStatus = "pending" | "verified" | "rejected";
export type AccessGrantStatus = "active" | "revoked" | "expired";

export type ActorMembership = {
  organizationId: UUIDv7;
  status: MembershipStatus;
};

export type ActorAccessGrant = {
  id: UUIDv7;
  organizationId?: UUIDv7;
  status: AccessGrantStatus;
  expiresAt?: Date;
};

export type AuthorizationCheckInput = {
  now: Date;
  actorUserId: UUIDv7;
  actorStatus: ActorStatus;
  actorRoleKeys: ReadonlyArray<RoleKey>;
  subjectUserId: UUIDv7;
  action: AuthorizationAction;
  organizationId?: UUIDv7;
  actorMembership?: ActorMembership;
  actorProfessionalVerificationStatus?: VerificationStatus;
  accessGrant?: ActorAccessGrant;
  /** Build plan §7 Phase: real value comes from the Consent module (Phase 7); defaults to false until then. */
  consentWithdrawn?: boolean;
};

export type AuthorizationDecision = {
  allowed: boolean;
  reasonCode: AuthorizationReasonCode;
  constraints?: AuthorizationConstraints;
};

function allow(
  reasonCode: AuthorizationReasonCode,
  constraints?: AuthorizationConstraints,
): AuthorizationDecision {
  return constraints ? { allowed: true, reasonCode, constraints } : { allowed: true, reasonCode };
}

function deny(reasonCode: AuthorizationReasonCode): AuthorizationDecision {
  return { allowed: false, reasonCode };
}

const ADMIN_ROLE_KEYS: ReadonlySet<RoleKey> = new Set(["organization_admin", "organization_owner"]);

export function evaluateAccess(input: AuthorizationCheckInput): AuthorizationDecision {
  if (input.actorStatus !== "active") {
    return deny("DENIED_ACTOR_ACCOUNT_INACTIVE");
  }

  // The self-access shortcut only applies to clinical data: subjectUserId
  // is not a meaningful concept for organization management (there is no
  // "subject" being administered, only the organization itself), so an
  // admin/manage action must never be able to bypass the membership/role
  // checks in evaluateAdministrativeAccess just because a caller happened
  // to pass its own id as subjectUserId.
  if (input.action === "read_clinical_data" && input.actorUserId === input.subjectUserId) {
    if (input.consentWithdrawn) {
      return deny("DENIED_CONSENT_WITHDRAWN");
    }
    return allow("AUTHORIZED_SELF_ACCESS");
  }

  if (input.action === "read_clinical_data") {
    return evaluateClinicalAccess(input);
  }

  return evaluateAdministrativeAccess(input);
}

/**
 * Build plan §11: a professional may access an individual's shared
 * data only when EVERY condition holds -- active account (checked
 * above), completed verification, active membership or approved
 * independent context, an unexpired/unrevoked grant, and no withdrawn
 * consent. "An organization administrator never automatically
 * receives health data access": org-admin-only actors are denied
 * before the professional/grant checks even run.
 */
function evaluateClinicalAccess(input: AuthorizationCheckInput): AuthorizationDecision {
  const isProfessional = input.actorRoleKeys.includes("professional");
  const isAdminOnly = input.actorRoleKeys.some((k) => ADMIN_ROLE_KEYS.has(k)) && !isProfessional;
  if (isAdminOnly) return deny("DENIED_ADMINISTRATIVE_ROLE_NOT_CLINICAL");

  if (input.actorRoleKeys.includes("support_agent")) {
    return deny("DENIED_SUPPORT_ROLE_HEALTH_DATA_RESTRICTED");
  }

  if (!isProfessional) return deny("DENIED_PERMISSION_NOT_ASSIGNED");

  if (input.actorProfessionalVerificationStatus !== "verified") {
    return deny("DENIED_PROFESSIONAL_NOT_VERIFIED");
  }

  // organizationId present => the grant is claimed through an org
  // context, which requires active membership in THAT org. Absent =>
  // "approved independent context" (build plan §11); no membership to check.
  if (input.organizationId) {
    if (!input.actorMembership || input.actorMembership.organizationId !== input.organizationId) {
      return deny("DENIED_CROSS_ORGANIZATION");
    }
    if (input.actorMembership.status !== "active") {
      return deny("DENIED_NO_ACTIVE_MEMBERSHIP");
    }
  }

  if (!input.accessGrant) return deny("DENIED_ACCESS_GRANT_NOT_FOUND");
  if (input.accessGrant.status === "revoked") return deny("DENIED_ACCESS_GRANT_REVOKED");
  if (input.accessGrant.status === "expired") return deny("DENIED_ACCESS_GRANT_EXPIRED");
  if (input.accessGrant.expiresAt && input.accessGrant.expiresAt <= input.now) {
    return deny("DENIED_ACCESS_GRANT_EXPIRED");
  }

  if (input.consentWithdrawn) return deny("DENIED_CONSENT_WITHDRAWN");

  return allow("AUTHORIZED_BY_ACTIVE_ACCESS_GRANT", {
    ...(input.accessGrant.organizationId
      ? { organizationId: input.accessGrant.organizationId }
      : {}),
    subjectUserId: input.subjectUserId,
    ...(input.accessGrant.expiresAt
      ? { expiresAt: input.accessGrant.expiresAt.toISOString() }
      : {}),
  });
}

/**
 * Administrative actions (org roster/settings) require active
 * membership plus an admin/owner role in that same organization.
 * Never grants clinical data access -- see evaluateClinicalAccess.
 */
function evaluateAdministrativeAccess(input: AuthorizationCheckInput): AuthorizationDecision {
  if (!input.organizationId) return deny("DENIED_PERMISSION_NOT_ASSIGNED");

  if (!input.actorMembership || input.actorMembership.organizationId !== input.organizationId) {
    return deny("DENIED_CROSS_ORGANIZATION");
  }
  if (input.actorMembership.status !== "active") {
    return deny("DENIED_NO_ACTIVE_MEMBERSHIP");
  }

  // read_administrative_data: any active member may view roster/settings.
  // manage_organization (and any future write action): admin/owner only.
  if (input.action !== "manage_organization") {
    return allow("AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE", { organizationId: input.organizationId });
  }

  const hasAdminRole = input.actorRoleKeys.some((k) => ADMIN_ROLE_KEYS.has(k));
  if (!hasAdminRole) return deny("DENIED_PERMISSION_NOT_ASSIGNED");

  return allow("AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE", { organizationId: input.organizationId });
}
