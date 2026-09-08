import { describe, expect, it } from "vitest";
import { UUIDv7 } from "../uuid.js";
import { AccessGrantCreateRequestSchema, AccessGrantSchema } from "./access-grant.js";
import {
  AUTHORIZATION_REASON_CODES,
  AuthorizationCheckRequestSchema,
  AuthorizationCheckResponseSchema,
} from "./authorization.js";
import {
  InvitationAcceptRequestSchema,
  InvitationCreateRequestSchema,
  InvitationPreviewRequestSchema,
  InvitationPreviewResponseSchema,
  InvitationSchema,
} from "./invitation.js";
import { MembershipPatchRequestSchema, MembershipSchema } from "./membership.js";
import { OrganizationCreateRequestSchema, OrganizationSchema } from "./organization.js";
import { RoleKeySchema } from "./roles.js";
import {
  MeResponseSchema,
  ProfilePatchRequestSchema,
  RegistrationRequestSchema,
  UserProvisionRequestSchema,
  UserResolveRequestSchema,
  UserResolveResponseSchema,
  UserSchema,
} from "./user.js";
import { VerificationCaseSchema } from "./verification-case.js";

describe("UserSchema", () => {
  it("accepts a valid user", () => {
    const r = UserSchema.safeParse({
      id: UUIDv7(),
      email: "a@example.com",
      locale: "es",
      status: "active",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-UUIDv7 id and an invalid email", () => {
    expect(
      UserSchema.safeParse({ id: "not-a-uuid", email: "x", locale: "es", status: "active" })
        .success,
    ).toBe(false);
  });
});

describe("MeResponseSchema", () => {
  it("accepts null profiles (no profile created yet)", () => {
    const r = MeResponseSchema.safeParse({
      user: { id: UUIDv7(), email: "a@example.com", locale: "es", status: "active" },
      individualProfile: null,
      professionalProfile: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("ProfilePatchRequestSchema", () => {
  it("accepts a partial patch", () => {
    expect(ProfilePatchRequestSchema.safeParse({ firstName: "Ada" }).success).toBe(true);
  });

  it("rejects an empty patch", () => {
    expect(ProfilePatchRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(ProfilePatchRequestSchema.safeParse({ email: "new@example.com" }).success).toBe(false);
  });
});

describe("OrganizationSchema / OrganizationCreateRequestSchema", () => {
  it("round-trips a valid organization", () => {
    const r = OrganizationSchema.safeParse({ id: UUIDv7(), name: "Acme", status: "active" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty name on create", () => {
    expect(OrganizationCreateRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("MembershipSchema / MembershipPatchRequestSchema", () => {
  it("round-trips a valid membership", () => {
    const r = MembershipSchema.safeParse({
      id: UUIDv7(),
      organizationId: UUIDv7(),
      userId: UUIDv7(),
      status: "active",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid status transition value", () => {
    expect(MembershipPatchRequestSchema.safeParse({ status: "banned" }).success).toBe(false);
  });
});

describe("InvitationSchema family", () => {
  it("create request accepts email-only (roleKey optional)", () => {
    expect(InvitationCreateRequestSchema.safeParse({ email: "invitee@example.com" }).success).toBe(
      true,
    );
  });

  it("create request rejects an invalid role key", () => {
    expect(
      InvitationCreateRequestSchema.safeParse({ email: "a@example.com", roleKey: "wizard" })
        .success,
    ).toBe(false);
  });

  it("the listing schema never includes a token field", () => {
    expect("token" in InvitationSchema.shape).toBe(false);
  });

  it("accept request requires a non-empty token", () => {
    expect(InvitationAcceptRequestSchema.safeParse({ token: "" }).success).toBe(false);
    expect(InvitationAcceptRequestSchema.safeParse({ token: "abc" }).success).toBe(true);
  });
});

describe("VerificationCaseSchema", () => {
  it("accepts a pending case with no reviewer yet", () => {
    const r = VerificationCaseSchema.safeParse({
      id: UUIDv7(),
      professionalProfileId: UUIDv7(),
      status: "pending",
    });
    expect(r.success).toBe(true);
  });
});

describe("AccessGrantSchema / AccessGrantCreateRequestSchema", () => {
  it("round-trips a valid grant", () => {
    const r = AccessGrantSchema.safeParse({
      id: UUIDv7(),
      professionalUserId: UUIDv7(),
      subjectUserId: UUIDv7(),
      scope: "clinical_data:read",
      status: "active",
    });
    expect(r.success).toBe(true);
  });

  it("create request rejects a malformed expiresAt", () => {
    const r = AccessGrantCreateRequestSchema.safeParse({
      professionalUserId: UUIDv7(),
      scope: "clinical_data:read",
      expiresAt: "not-a-date",
    });
    expect(r.success).toBe(false);
  });
});

describe("Authorization contracts", () => {
  it("request requires actorUserId, subjectUserId, action", () => {
    const r = AuthorizationCheckRequestSchema.safeParse({
      actorUserId: UUIDv7(),
      subjectUserId: UUIDv7(),
      action: "read_clinical_data",
    });
    expect(r.success).toBe(true);
  });

  it("request rejects an unknown action", () => {
    const r = AuthorizationCheckRequestSchema.safeParse({
      actorUserId: UUIDv7(),
      subjectUserId: UUIDv7(),
      action: "delete_everything",
    });
    expect(r.success).toBe(false);
  });

  it("response matches the build plan §20 Checkpoint 6.2 example exactly", () => {
    const r = AuthorizationCheckResponseSchema.safeParse({
      allowed: true,
      decisionId: UUIDv7(),
      reasonCode: "AUTHORIZED_BY_ACTIVE_ACCESS_GRANT",
      constraints: {
        organizationId: UUIDv7(),
        subjectUserId: UUIDv7(),
        expiresAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(r.success).toBe(true);
  });

  it("response accepts a denial with no constraints", () => {
    const r = AuthorizationCheckResponseSchema.safeParse({
      allowed: false,
      decisionId: UUIDv7(),
      reasonCode: "DENIED_ACCESS_GRANT_NOT_FOUND",
    });
    expect(r.success).toBe(true);
  });

  it("every reasonCode round-trips through the response schema", () => {
    for (const reasonCode of AUTHORIZATION_REASON_CODES) {
      const r = AuthorizationCheckResponseSchema.safeParse({
        allowed: reasonCode.startsWith("AUTHORIZED_"),
        decisionId: UUIDv7(),
        reasonCode,
      });
      expect(r.success, `reasonCode ${reasonCode} failed to parse`).toBe(true);
    }
  });
});

describe("UserResolveRequestSchema / UserResolveResponseSchema", () => {
  it("accepts a valid resolve request", () => {
    expect(UserResolveRequestSchema.safeParse({ providerUserId: "firebase-uid-123" }).success).toBe(
      true,
    );
  });

  it("rejects an empty providerUserId", () => {
    expect(UserResolveRequestSchema.safeParse({ providerUserId: "" }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(UserResolveRequestSchema.safeParse({ providerUserId: "x", extra: 1 }).success).toBe(
      false,
    );
  });

  it("accepts a valid resolve response", () => {
    const r = UserResolveResponseSchema.safeParse({
      userId: UUIDv7(),
      email: "a@example.com",
      locale: "es",
      status: "active",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a response missing status", () => {
    expect(
      UserResolveResponseSchema.safeParse({
        userId: UUIDv7(),
        email: "a@example.com",
        locale: "es",
      }).success,
    ).toBe(false);
  });
});

describe("RegistrationRequestSchema (Addendum A Checkpoint 14.1: one flow, three role branches)", () => {
  /** Both required purposes, separate flags -- never one combined value (build plan §13). */
  const consents = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;
  const common = { firstName: "Ada", lastName: "Lovelace", consents } as const;

  it("accepts the adult branch (identity still comes from the session)", () => {
    expect(
      RegistrationRequestSchema.safeParse({ ...common, role: "adult", ageYears: 34 }).success,
    ).toBe(true);
    expect(
      RegistrationRequestSchema.safeParse({ ...common, role: "adult", ageYears: 18, locale: "ca" })
        .success,
    ).toBe(true);
  });

  it("accepts the parent branch with a guardianship confirmation and a minor age band", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "parent",
        guardianshipConfirmed: true,
        minorAgeBand: "6-12y",
      }).success,
    ).toBe(true);
  });

  it("accepts the professional branch with a specialty and a licence number", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "professional",
        specialty: "sleep_physician",
        licenseNumber: "COL-12345",
      }).success,
    ).toBe(true);
  });

  it("rejects a client-supplied providerUserId or email (strict)", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "adult",
        ageYears: 34,
        email: "a@b.com",
      }).success,
    ).toBe(false);
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "adult",
        ageYears: 34,
        providerUserId: "firebase-uid-1",
      }).success,
    ).toBe(false);
  });

  it("rejects a minor age, or a missing age, on the adult branch", () => {
    expect(
      RegistrationRequestSchema.safeParse({ ...common, role: "adult", ageYears: 17 }).success,
    ).toBe(false);
    expect(RegistrationRequestSchema.safeParse({ ...common, role: "adult" }).success).toBe(false);
  });

  it("rejects a guardian who omits or denies the guardianship confirmation", () => {
    expect(
      RegistrationRequestSchema.safeParse({ ...common, role: "parent", minorAgeBand: "3-5y" })
        .success,
    ).toBe(false);
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "parent",
        guardianshipConfirmed: false,
        minorAgeBand: "3-5y",
      }).success,
    ).toBe(false);
  });

  it("rejects an age band outside Morpheo's role definitions (§14a)", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "parent",
        guardianshipConfirmed: true,
        minorAgeBand: "18-20y",
      }).success,
    ).toBe(false);
  });

  it("rejects a professional without a specialty or without a licence number", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "professional",
        licenseNumber: "COL-1",
      }).success,
    ).toBe(false);
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "professional",
        specialty: "psychologist",
      }).success,
    ).toBe(false);
  });

  it("rejects either consent purpose being absent or false -- they are never combined", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        firstName: "Ada",
        lastName: "Lovelace",
        role: "adult",
        ageYears: 34,
        consents: { termsAcceptance: true },
      }).success,
    ).toBe(false);
    expect(
      RegistrationRequestSchema.safeParse({
        firstName: "Ada",
        lastName: "Lovelace",
        role: "adult",
        ageYears: 34,
        consents: { termsAcceptance: true, privacyPolicyAcknowledgement: false },
      }).success,
    ).toBe(false);
  });

  it("rejects branch fields leaking across branches (strict)", () => {
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "adult",
        ageYears: 34,
        minorAgeBand: "6-12y",
      }).success,
    ).toBe(false);
    expect(
      RegistrationRequestSchema.safeParse({
        ...common,
        role: "professional",
        specialty: "nurse",
        licenseNumber: "COL-1",
        guardianshipConfirmed: true,
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown role and a missing name", () => {
    expect(RegistrationRequestSchema.safeParse({ ...common, role: "platform_admin" }).success).toBe(
      false,
    );
    expect(
      RegistrationRequestSchema.safeParse({
        firstName: "Ada",
        role: "adult",
        ageYears: 34,
        consents,
      }).success,
    ).toBe(false);
  });
});

describe("UserProvisionRequestSchema", () => {
  const consents = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;
  const common = {
    providerUserId: "firebase-uid-1",
    email: "a@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    consents,
  } as const;

  it("accepts a full provision request on every branch", () => {
    expect(
      UserProvisionRequestSchema.safeParse({ ...common, role: "adult", ageYears: 34 }).success,
    ).toBe(true);
    expect(
      UserProvisionRequestSchema.safeParse({
        ...common,
        role: "parent",
        guardianshipConfirmed: true,
        minorAgeBand: "0-3m",
      }).success,
    ).toBe(true);
    expect(
      UserProvisionRequestSchema.safeParse({
        ...common,
        role: "professional",
        specialty: "pediatrician",
        licenseNumber: "COL-9",
      }).success,
    ).toBe(true);
  });

  it("rejects a missing provider id or email", () => {
    expect(
      UserProvisionRequestSchema.safeParse({
        email: "a@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "adult",
        ageYears: 34,
        consents,
      }).success,
    ).toBe(false);
    expect(
      UserProvisionRequestSchema.safeParse({
        providerUserId: "firebase-uid-1",
        firstName: "Ada",
        lastName: "Lovelace",
        role: "adult",
        ageYears: 34,
        consents,
      }).success,
    ).toBe(false);
  });

  it("carries the same branch rules as the registration request", () => {
    expect(
      UserProvisionRequestSchema.safeParse({ ...common, role: "adult", ageYears: 12 }).success,
    ).toBe(false);
    expect(
      UserProvisionRequestSchema.safeParse({
        ...common,
        role: "parent",
        guardianshipConfirmed: false,
        minorAgeBand: "1-2y",
      }).success,
    ).toBe(false);
  });
});

describe("InvitationPreviewResponseSchema (Addendum A Checkpoint 14.2)", () => {
  const valid = {
    organizationName: "Acme Health",
    email: "invited@example.com",
    expiresAt: new Date().toISOString(),
  };

  it("accepts an organization name, the invited email and an expiry", () => {
    expect(InvitationPreviewResponseSchema.safeParse(valid).success).toBe(true);
  });

  it("requires every field", () => {
    for (const key of ["organizationName", "email", "expiresAt"] as const) {
      const { [key]: _dropped, ...rest } = valid;
      expect(InvitationPreviewResponseSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("rejects an empty organization name and a non-email address", () => {
    expect(
      InvitationPreviewResponseSchema.safeParse({ ...valid, organizationName: "" }).success,
    ).toBe(false);
    expect(InvitationPreviewResponseSchema.safeParse({ ...valid, email: "nope" }).success).toBe(
      false,
    );
  });

  it("carries no organization id, role or inviter -- it is read by an unauthenticated caller", () => {
    const parsed = InvitationPreviewResponseSchema.parse({
      ...valid,
      organizationId: "01900000-0000-7000-8000-000000000000",
      roleKey: "professional",
      invitedBy: "someone",
    });
    expect(Object.keys(parsed).sort()).toEqual(["email", "expiresAt", "organizationName"]);
  });
});

describe("InvitationPreviewRequestSchema", () => {
  it("accepts a token and rejects anything else alongside it (strict)", () => {
    expect(InvitationPreviewRequestSchema.safeParse({ token: "abc" }).success).toBe(true);
    expect(InvitationPreviewRequestSchema.safeParse({ token: "" }).success).toBe(false);
    expect(InvitationPreviewRequestSchema.safeParse({}).success).toBe(false);
    expect(
      InvitationPreviewRequestSchema.safeParse({ token: "abc", email: "a@b.com" }).success,
    ).toBe(false);
  });
});

describe("RoleKeySchema", () => {
  it("accepts every build plan §11 role", () => {
    for (const key of [
      "individual_user",
      "professional",
      "organization_owner",
      "organization_admin",
      "professional_manager",
      "clinical_supervisor",
      "support_agent",
      "professional_verifier",
      "clinical_governance_reviewer",
      "platform_admin",
      "platform_super_admin",
    ]) {
      expect(RoleKeySchema.safeParse(key).success, key).toBe(true);
    }
  });

  it("rejects a professional specialty masquerading as a role (build plan §11)", () => {
    expect(RoleKeySchema.safeParse("psychologist").success).toBe(false);
  });
});
