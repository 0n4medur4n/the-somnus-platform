import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  INTERNAL_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey,
} from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import {
  capabilitiesFor,
  evaluateAdminCapability,
  internalRolesOf,
} from "../../src/domain/authorization/admin-capability-policy.js";

/**
 * Addendum A §A2.2 / Checkpoint 15.1: the admin console capability matrix.
 *
 * The expectation below is transcribed independently from the addendum's table
 * rather than imported from the policy -- a test that read the same table it is
 * checking would assert nothing. Every one of the 12 capabilities x 11 roles
 * cells is then asserted, so a cell cannot be widened without this failing.
 */
const EXPECTED: Readonly<Record<AdminCapability, ReadonlyArray<RoleKey>>> = {
  admin_users_read: [
    "support_agent",
    "professional_verifier",
    "platform_admin",
    "platform_super_admin",
  ],
  admin_account_status_write: ["platform_admin", "platform_super_admin"],
  admin_deletion_requests_process: ["platform_admin", "platform_super_admin"],
  admin_verification_queue: ["professional_verifier", "platform_admin", "platform_super_admin"],
  admin_organizations_manage: ["platform_admin", "platform_super_admin"],
  admin_roles_assign: ["platform_super_admin"],
  admin_content_review: ["clinical_governance_reviewer", "platform_super_admin"],
  admin_statistics_read: [
    "support_agent",
    "clinical_governance_reviewer",
    "platform_admin",
    "platform_super_admin",
  ],
  admin_audit_read: ["clinical_governance_reviewer", "platform_admin", "platform_super_admin"],
  admin_consent_read: ["support_agent", "platform_admin", "platform_super_admin"],
  admin_break_glass: ["clinical_governance_reviewer", "platform_admin", "platform_super_admin"],
  admin_system_health: ["platform_admin", "platform_super_admin"],
};

const EXTERNAL_ROLES = ROLE_KEYS.filter((key) => !INTERNAL_ROLE_KEYS.has(key));

describe("no external role reaches any admin capability (negative first)", () => {
  it("covers every capability and every role: the matrix is complete", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ADMIN_CAPABILITIES].sort());
    expect(EXTERNAL_ROLES).toEqual([
      "individual_user",
      "professional",
      "organization_owner",
      "organization_admin",
      "professional_manager",
      "clinical_supervisor",
    ]);
  });

  it.each(EXTERNAL_ROLES)("%s is denied every admin capability", (role) => {
    for (const capability of ADMIN_CAPABILITIES) {
      const decision = evaluateAdminCapability({
        actorStatus: "active",
        actorRoleKeys: [role],
        capability,
      });
      expect(decision.allowed, `${role} must not hold ${capability}`).toBe(false);
      expect(decision.reasonCode).toBe("DENIED_NOT_AN_INTERNAL_ROLE");
    }
    expect(capabilitiesFor("active", [role])).toEqual([]);
  });

  it("an actor holding every external role at once is still not an admin", () => {
    expect(capabilitiesFor("active", EXTERNAL_ROLES)).toEqual([]);
  });

  it("an actor with no roles at all is denied", () => {
    const decision = evaluateAdminCapability({
      actorStatus: "active",
      actorRoleKeys: [],
      capability: "admin_users_read",
    });
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_NOT_AN_INTERNAL_ROLE" });
  });
});

describe("the capability matrix matches Addendum A §A2.2, cell by cell", () => {
  for (const capability of ADMIN_CAPABILITIES) {
    describe(capability, () => {
      it.each(ROLE_KEYS)("%s", (role) => {
        const shouldAllow = EXPECTED[capability].includes(role);
        const decision = evaluateAdminCapability({
          actorStatus: "active",
          actorRoleKeys: [role],
          capability,
        });

        expect(
          decision.allowed,
          `${role} ${shouldAllow ? "must" : "must NOT"} hold ${capability}`,
        ).toBe(shouldAllow);

        if (shouldAllow) {
          expect(decision.reasonCode).toBe("AUTHORIZED_BY_INTERNAL_ROLE");
        } else {
          // An internal role that simply lacks this cell is a different denial
          // from "not an admin at all", and the console needs to tell them apart.
          expect(decision.reasonCode).toBe(
            INTERNAL_ROLE_KEYS.has(role)
              ? "DENIED_CAPABILITY_NOT_GRANTED"
              : "DENIED_NOT_AN_INTERNAL_ROLE",
          );
        }
      });
    });
  }
});

describe("cells the addendum makes deliberately non-obvious", () => {
  it("platform_admin is NOT a superset: it has no AI content review", () => {
    expect(capabilitiesFor("active", ["platform_admin"])).not.toContain("admin_content_review");
    expect(capabilitiesFor("active", ["clinical_governance_reviewer"])).toContain(
      "admin_content_review",
    );
  });

  it("only platform_super_admin may assign internal roles", () => {
    for (const role of ROLE_KEYS) {
      expect(
        evaluateAdminCapability({
          actorStatus: "active",
          actorRoleKeys: [role],
          capability: "admin_roles_assign",
        }).allowed,
        role,
      ).toBe(role === "platform_super_admin");
    }
  });

  it("clinical_governance_reviewer cannot search users or touch accounts", () => {
    const capabilities = capabilitiesFor("active", ["clinical_governance_reviewer"]);
    expect(capabilities).not.toContain("admin_users_read");
    expect(capabilities).not.toContain("admin_account_status_write");
    expect(capabilities).not.toContain("admin_consent_read");
  });

  it("support_agent never reaches health data: no break-glass, no audit log", () => {
    const capabilities = capabilitiesFor("active", ["support_agent"]);
    expect(capabilities).not.toContain("admin_break_glass");
    expect(capabilities).not.toContain("admin_audit_read");
    expect(capabilities).toEqual([
      "admin_users_read",
      "admin_statistics_read",
      "admin_consent_read",
    ]);
  });

  it("professional_verifier sees the queue and users, and nothing else", () => {
    expect(capabilitiesFor("active", ["professional_verifier"])).toEqual([
      "admin_users_read",
      "admin_verification_queue",
    ]);
  });

  it("platform_super_admin holds every capability", () => {
    expect(capabilitiesFor("active", ["platform_super_admin"])).toEqual([...ADMIN_CAPABILITIES]);
  });
});

describe("account status is checked before any capability", () => {
  it.each(["suspended", "deleted"] as const)("a %s super admin is refused everything", (status) => {
    for (const capability of ADMIN_CAPABILITIES) {
      const decision = evaluateAdminCapability({
        actorStatus: status,
        actorRoleKeys: ["platform_super_admin"],
        capability,
      });
      expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_ACTOR_ACCOUNT_INACTIVE" });
    }
    expect(capabilitiesFor(status, ["platform_super_admin"])).toEqual([]);
  });
});

describe("internalRolesOf", () => {
  it("keeps only internal roles, so the console cannot read external ones", () => {
    expect(internalRolesOf(["professional", "platform_admin", "organization_owner"])).toEqual([
      "platform_admin",
    ]);
    expect(internalRolesOf(["individual_user"])).toEqual([]);
  });
});
