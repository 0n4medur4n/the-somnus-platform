import {
  ADMIN_CAPABILITIES,
  type AdminAuthorizationReasonCode,
  type AdminCapability,
  INTERNAL_ROLE_KEYS,
  type RoleKey,
} from "@somnus/api-contracts";
import type { ActorStatus } from "./authorization-policy.js";

/**
 * The admin console capability matrix (Addendum A §A2.2), as a pure function.
 *
 * Zero dependencies on NestJS, Drizzle or HTTP, exactly like
 * `authorization-policy.ts`: the caller resolves the facts (account status,
 * role keys) and this decides. It lives here and nowhere else -- edge-api knows
 * which capability a route needs, never who may use it (build plan §5.3).
 *
 * The table below is a direct transcription of the addendum's matrix, one entry
 * per row, in the addendum's own order. It is written out in full rather than
 * derived from a hierarchy: `platform_admin` is NOT a superset of
 * `clinical_governance_reviewer` (the reviewer holds AI content review, the
 * admin does not), and `platform_super_admin` is the only role that may assign
 * internal roles. A "seniority" shortcut would quietly grant the wrong cells.
 */
const CAPABILITY_ROLES: Readonly<Record<AdminCapability, ReadonlySet<RoleKey>>> = Object.freeze({
  // Search users, view account status/metadata
  admin_users_read: new Set<RoleKey>([
    "support_agent",
    "professional_verifier",
    "platform_admin",
    "platform_super_admin",
  ]),
  // Suspend / reactivate account
  admin_account_status_write: new Set<RoleKey>(["platform_admin", "platform_super_admin"]),
  // Process deletion requests
  admin_deletion_requests_process: new Set<RoleKey>(["platform_admin", "platform_super_admin"]),
  // Professional verification queue (approve/reject)
  admin_verification_queue: new Set<RoleKey>([
    "professional_verifier",
    "platform_admin",
    "platform_super_admin",
  ]),
  // Organizations: create, approve, view members
  admin_organizations_manage: new Set<RoleKey>(["platform_admin", "platform_super_admin"]),
  // Assign internal roles -- super admin ONLY (§A2.2, and the immutable
  // self-assignment negative from Checkpoint 6.3 still applies on top).
  admin_roles_assign: new Set<RoleKey>(["platform_super_admin"]),
  // AI content review queue
  admin_content_review: new Set<RoleKey>(["clinical_governance_reviewer", "platform_super_admin"]),
  // Statistics dashboards (aggregate, from BigQuery)
  admin_statistics_read: new Set<RoleKey>([
    "support_agent",
    "clinical_governance_reviewer",
    "platform_admin",
    "platform_super_admin",
  ]),
  // Audit log viewer
  admin_audit_read: new Set<RoleKey>([
    "clinical_governance_reviewer",
    "platform_admin",
    "platform_super_admin",
  ]),
  // CSV export of the audit log -- super admin ONLY (§A4 Checkpoint 15.4).
  // Reading the log on screen is a wider set; taking a copy of it out of the
  // platform is not.
  admin_audit_export: new Set<RoleKey>(["platform_super_admin"]),
  // Consent records viewer (per user, metadata only)
  admin_consent_read: new Set<RoleKey>(["support_agent", "platform_admin", "platform_super_admin"]),
  // Break-glass: view an individual's clinical answers/results.
  // Justification is enforced separately (Checkpoint 15.5); this row only
  // decides who may ever reach the prompt at all.
  admin_break_glass: new Set<RoleKey>([
    "clinical_governance_reviewer",
    "platform_admin",
    "platform_super_admin",
  ]),
  // System health (service status, queue depths, error rates)
  admin_system_health: new Set<RoleKey>(["platform_admin", "platform_super_admin"]),
  // Reference-corpus management -- super admin ONLY (Addendum B §B5 Checkpoint
  // 16.3, decided in §B6 item 4). The narrowest row in this table apart from
  // role assignment, and narrower than `admin_content_review`:
  // `clinical_governance_reviewer` does NOT hold it, nor does `platform_admin`.
  // A published corpus document is what an AI wording step grounds in, and §B6
  // chose a single-role restriction over a separate review gate.
  admin_corpus_manage: new Set<RoleKey>(["platform_super_admin"]),
});

export type AdminCapabilityInput = {
  actorStatus: ActorStatus;
  actorRoleKeys: ReadonlyArray<RoleKey>;
  capability: AdminCapability;
};

export type AdminCapabilityDecision = {
  allowed: boolean;
  reasonCode: AdminAuthorizationReasonCode;
};

/** The internal roles an actor holds. External roles are never admin-relevant. */
export function internalRolesOf(roleKeys: ReadonlyArray<RoleKey>): RoleKey[] {
  return roleKeys.filter((key) => INTERNAL_ROLE_KEYS.has(key));
}

export function evaluateAdminCapability(input: AdminCapabilityInput): AdminCapabilityDecision {
  if (input.actorStatus !== "active") {
    return { allowed: false, reasonCode: "DENIED_ACTOR_ACCOUNT_INACTIVE" };
  }

  const internalRoles = internalRolesOf(input.actorRoleKeys);
  if (internalRoles.length === 0) {
    // Holding `professional` or `organization_owner` is not being an admin.
    // This is the denial the console's denial screen renders.
    return { allowed: false, reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE" };
  }

  const granted = CAPABILITY_ROLES[input.capability];
  if (internalRoles.some((role) => granted.has(role))) {
    return { allowed: true, reasonCode: "AUTHORIZED_BY_INTERNAL_ROLE" };
  }
  return { allowed: false, reasonCode: "DENIED_CAPABILITY_NOT_GRANTED" };
}

/**
 * Every capability this actor holds, in the vocabulary's declared order. The
 * console shell renders from this, so it can never show a control identity
 * would refuse.
 */
export function capabilitiesFor(
  actorStatus: ActorStatus,
  actorRoleKeys: ReadonlyArray<RoleKey>,
): AdminCapability[] {
  return ADMIN_CAPABILITIES.filter(
    (capability) => evaluateAdminCapability({ actorStatus, actorRoleKeys, capability }).allowed,
  );
}
