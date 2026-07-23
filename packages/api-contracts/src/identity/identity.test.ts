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
  InvitationSchema,
} from "./invitation.js";
import { MembershipPatchRequestSchema, MembershipSchema } from "./membership.js";
import { OrganizationCreateRequestSchema, OrganizationSchema } from "./organization.js";
import { RoleKeySchema } from "./roles.js";
import { MeResponseSchema, ProfilePatchRequestSchema, UserSchema } from "./user.js";
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
