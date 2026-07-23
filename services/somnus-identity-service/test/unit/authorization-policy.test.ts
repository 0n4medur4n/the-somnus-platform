import { UUIDv7 } from "@somnus/api-contracts";
import { describe, expect, it } from "vitest";
import {
  type AuthorizationCheckInput,
  evaluateAccess,
} from "../../src/domain/authorization/authorization-policy.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function baseInput(overrides: Partial<AuthorizationCheckInput> = {}): AuthorizationCheckInput {
  return {
    now: NOW,
    actorUserId: UUIDv7(),
    actorStatus: "active",
    actorRoleKeys: [],
    subjectUserId: UUIDv7(),
    action: "read_clinical_data",
    ...overrides,
  };
}

describe("evaluateAccess -- self access", () => {
  it("AUTHORIZED_SELF_ACCESS: a user accessing their own data is always allowed", () => {
    const userId = UUIDv7();
    const decision = evaluateAccess(baseInput({ actorUserId: userId, subjectUserId: userId }));
    expect(decision).toEqual({ allowed: true, reasonCode: "AUTHORIZED_SELF_ACCESS" });
  });

  it("DENIED_CONSENT_WITHDRAWN: self access to clinical data is denied once consent is withdrawn", () => {
    const userId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({ actorUserId: userId, subjectUserId: userId, consentWithdrawn: true }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("DENIED_CONSENT_WITHDRAWN");
  });

  it("the self-access shortcut does not apply to administrative actions: actorUserId === subjectUserId alone is not enough to manage an organization", () => {
    const userId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        actorUserId: userId,
        subjectUserId: userId,
        action: "manage_organization",
        organizationId: UUIDv7(),
      }),
    );
    // Falls through to evaluateAdministrativeAccess like any other actor
    // with no membership in the requested organization.
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_CROSS_ORGANIZATION" });
  });
});

describe("evaluateAccess -- actor account status", () => {
  it.each(["suspended", "deleted"] as const)(
    "DENIED_ACTOR_ACCOUNT_INACTIVE: a %s actor is denied before any other check",
    (actorStatus) => {
      const decision = evaluateAccess(baseInput({ actorStatus }));
      expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_ACTOR_ACCOUNT_INACTIVE" });
    },
  );
});

describe("evaluateAccess -- clinical data access", () => {
  it("AUTHORIZED_BY_ACTIVE_ACCESS_GRANT: verified professional with an active grant is allowed (build plan §20 Checkpoint 6.2 example)", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        organizationId,
        actorMembership: { organizationId, status: "active" },
        accessGrant: { id: UUIDv7(), organizationId, status: "active" },
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("AUTHORIZED_BY_ACTIVE_ACCESS_GRANT");
    expect(decision.constraints?.organizationId).toBe(organizationId);
  });

  it("AUTHORIZED_BY_ACTIVE_ACCESS_GRANT: independent professional (no organizationId) needs no membership", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        accessGrant: { id: UUIDv7(), status: "active" },
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("AUTHORIZED_BY_ACTIVE_ACCESS_GRANT");
  });

  it("DENIED_ADMINISTRATIVE_ROLE_NOT_CLINICAL: an org admin who is not also a professional never gets clinical access automatically", () => {
    const decision = evaluateAccess(baseInput({ actorRoleKeys: ["organization_admin"] }));
    expect(decision).toEqual({
      allowed: false,
      reasonCode: "DENIED_ADMINISTRATIVE_ROLE_NOT_CLINICAL",
    });
  });

  it("DENIED_SUPPORT_ROLE_HEALTH_DATA_RESTRICTED: support staff are denied health data by default", () => {
    const decision = evaluateAccess(baseInput({ actorRoleKeys: ["support_agent"] }));
    expect(decision).toEqual({
      allowed: false,
      reasonCode: "DENIED_SUPPORT_ROLE_HEALTH_DATA_RESTRICTED",
    });
  });

  it("DENIED_PERMISSION_NOT_ASSIGNED: an actor with no relevant role at all is denied", () => {
    const decision = evaluateAccess(baseInput({ actorRoleKeys: ["individual_user"] }));
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_PERMISSION_NOT_ASSIGNED" });
  });

  it("DENIED_PROFESSIONAL_NOT_VERIFIED: a pending (unverified) professional is denied", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "pending",
      }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_PROFESSIONAL_NOT_VERIFIED" });
  });

  it("DENIED_PROFESSIONAL_NOT_VERIFIED: a rejected professional is denied", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "rejected",
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_PROFESSIONAL_NOT_VERIFIED");
  });

  it("DENIED_CROSS_ORGANIZATION: a verified professional's membership in a different org than requested is denied", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        organizationId: UUIDv7(),
        actorMembership: { organizationId: UUIDv7(), status: "active" },
      }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_CROSS_ORGANIZATION" });
  });

  it("DENIED_CROSS_ORGANIZATION: no membership at all when one is required for the requested org", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        organizationId: UUIDv7(),
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_CROSS_ORGANIZATION");
  });

  it.each(["inactive", "removed"] as const)(
    "DENIED_NO_ACTIVE_MEMBERSHIP: a %s membership in the right org is still denied",
    (status) => {
      const organizationId = UUIDv7();
      const decision = evaluateAccess(
        baseInput({
          actorRoleKeys: ["professional"],
          actorProfessionalVerificationStatus: "verified",
          organizationId,
          actorMembership: { organizationId, status },
        }),
      );
      expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_NO_ACTIVE_MEMBERSHIP" });
    },
  );

  it("DENIED_ACCESS_GRANT_NOT_FOUND: a verified, active-member professional with no grant is denied", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        organizationId,
        actorMembership: { organizationId, status: "active" },
      }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_ACCESS_GRANT_NOT_FOUND" });
  });

  it("DENIED_ACCESS_GRANT_REVOKED: a revoked grant denies access even though it was once granted", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        accessGrant: { id: UUIDv7(), status: "revoked" },
      }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_ACCESS_GRANT_REVOKED" });
  });

  it("DENIED_ACCESS_GRANT_EXPIRED: a grant whose status is already 'expired' is denied", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        accessGrant: { id: UUIDv7(), status: "expired" },
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_ACCESS_GRANT_EXPIRED");
  });

  it("DENIED_ACCESS_GRANT_EXPIRED: an 'active'-status grant whose expiresAt has already passed 'now' is still denied", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        accessGrant: {
          id: UUIDv7(),
          status: "active",
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_ACCESS_GRANT_EXPIRED");
  });

  it("an active grant with a future expiresAt is allowed and echoes expiresAt in constraints", () => {
    const expiresAt = new Date("2027-01-01T00:00:00.000Z");
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        accessGrant: { id: UUIDv7(), status: "active", expiresAt },
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.constraints?.expiresAt).toBe(expiresAt.toISOString());
  });

  it("DENIED_CONSENT_WITHDRAWN: an otherwise-valid grant is denied once consent is withdrawn", () => {
    const decision = evaluateAccess(
      baseInput({
        actorRoleKeys: ["professional"],
        actorProfessionalVerificationStatus: "verified",
        accessGrant: { id: UUIDv7(), status: "active" },
        consentWithdrawn: true,
      }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_CONSENT_WITHDRAWN" });
  });
});

describe("evaluateAccess -- read_administrative_data (any active member)", () => {
  it("AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE: an active plain member (no admin role) can read", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        action: "read_administrative_data",
        actorRoleKeys: ["individual_user"],
        organizationId,
        actorMembership: { organizationId, status: "active" },
      }),
    );
    expect(decision).toEqual({
      allowed: true,
      reasonCode: "AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE",
      constraints: { organizationId },
    });
  });

  it("DENIED_PERMISSION_NOT_ASSIGNED: no organizationId at all in the request", () => {
    const decision = evaluateAccess(baseInput({ action: "read_administrative_data" }));
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_PERMISSION_NOT_ASSIGNED" });
  });

  it("DENIED_CROSS_ORGANIZATION: member of a different organization than requested", () => {
    const decision = evaluateAccess(
      baseInput({
        action: "read_administrative_data",
        organizationId: UUIDv7(),
        actorMembership: { organizationId: UUIDv7(), status: "active" },
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_CROSS_ORGANIZATION");
  });

  it("DENIED_NO_ACTIVE_MEMBERSHIP: membership in the right org but not active", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        action: "read_administrative_data",
        organizationId,
        actorMembership: { organizationId, status: "inactive" },
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_NO_ACTIVE_MEMBERSHIP");
  });
});

describe("evaluateAccess -- manage_organization (admin/owner only)", () => {
  it("AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE: an active organization_admin is allowed", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        action: "manage_organization",
        actorRoleKeys: ["organization_admin"],
        organizationId,
        actorMembership: { organizationId, status: "active" },
      }),
    );
    expect(decision).toEqual({
      allowed: true,
      reasonCode: "AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE",
      constraints: { organizationId },
    });
  });

  it("AUTHORIZED_BY_ACTIVE_MEMBERSHIP_ROLE: organization_owner is also sufficient", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        action: "manage_organization",
        actorRoleKeys: ["organization_owner"],
        organizationId,
        actorMembership: { organizationId, status: "active" },
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("DENIED_PERMISSION_NOT_ASSIGNED: no organizationId at all in the request", () => {
    const decision = evaluateAccess(
      baseInput({ action: "manage_organization", actorRoleKeys: ["organization_admin"] }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_PERMISSION_NOT_ASSIGNED" });
  });

  it("DENIED_CROSS_ORGANIZATION: admin of a different organization than requested", () => {
    const decision = evaluateAccess(
      baseInput({
        action: "manage_organization",
        actorRoleKeys: ["organization_admin"],
        organizationId: UUIDv7(),
        actorMembership: { organizationId: UUIDv7(), status: "active" },
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_CROSS_ORGANIZATION");
  });

  it("DENIED_NO_ACTIVE_MEMBERSHIP: admin role but membership is inactive", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        action: "manage_organization",
        actorRoleKeys: ["organization_admin"],
        organizationId,
        actorMembership: { organizationId, status: "inactive" },
      }),
    );
    expect(decision.reasonCode).toBe("DENIED_NO_ACTIVE_MEMBERSHIP");
  });

  it("DENIED_PERMISSION_NOT_ASSIGNED: an active plain member without an admin/owner role cannot manage", () => {
    const organizationId = UUIDv7();
    const decision = evaluateAccess(
      baseInput({
        action: "manage_organization",
        actorRoleKeys: ["individual_user"],
        organizationId,
        actorMembership: { organizationId, status: "active" },
      }),
    );
    expect(decision).toEqual({ allowed: false, reasonCode: "DENIED_PERMISSION_NOT_ASSIGNED" });
  });
});
