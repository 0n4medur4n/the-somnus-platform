import { describe, expect, it } from "vitest";
import {
  PlatformInvitationAcceptRequestSchema,
  PlatformInvitationCreateRequestSchema,
} from "./platform-invitation.js";

const invitation = {
  firstName: " Ana ",
  lastName: " Garcia ",
  email: " ANA@EXAMPLE.COM ",
  role: "professional",
  locale: "ca",
};
describe("Morpheo invitation contracts", () => {
  it("normalizes addresses and names, preserving the selected email language", () => {
    expect(PlatformInvitationCreateRequestSchema.parse(invitation)).toEqual({
      ...invitation,
      firstName: "Ana",
      lastName: "Garcia",
      email: "ana@example.com",
    });
  });
  it.each(["platform_super_admin", "support_agent", "organization_owner", "parent", "nox"])(
    "rejects %s instead of a Morpheo registration branch",
    (role) => {
      expect(PlatformInvitationCreateRequestSchema.safeParse({ ...invitation, role }).success).toBe(
        false,
      );
    },
  );
  it("rejects forged identity and consent-free registration", () => {
    const invitationId = "018f0000-0000-7000-8000-000000000001";
    expect(
      PlatformInvitationAcceptRequestSchema.safeParse({ invitationId, email: "other@example.com" })
        .success,
    ).toBe(false);
    expect(
      PlatformInvitationAcceptRequestSchema.safeParse({
        invitationId,
        registration: { role: "adult" },
      }).success,
    ).toBe(false);
  });
  it("accepts existing accounts without overwriting a profile", () => {
    expect(
      PlatformInvitationAcceptRequestSchema.parse({
        invitationId: "018f0000-0000-7000-8000-000000000001",
      }),
    ).not.toHaveProperty("registration");
  });
});
