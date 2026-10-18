import { describe, expect, it, vi } from "vitest";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";
import { StaffInvitationService } from "../../src/modules/staff-invitation/staff-invitation.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";

function session(email: string | null): SessionRecord {
  return {
    sessionId: "018f0000-0000-7000-8000-000000000001",
    firebaseUid: "firebase-uid-1",
    email,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    somnusUserId: null,
  };
}

/** Staff invitations, invitee side (owner decision 2026-10-18). */
describe("StaffInvitationService", () => {
  it("looks up only the address the session verified", async () => {
    const { client, requests } = makeFakeIdentityClient(() => ({
      status: 200,
      body: {
        invitation: {
          firstName: "Ana",
          roleKey: "support_agent",
          expiresAt: new Date().toISOString(),
        },
      },
    }));
    const service = new StaffInvitationService(client, {} as SessionService);

    const result = await service.pending(session("ana@example.com"));

    expect(result.invitation?.roleKey).toBe("support_agent");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.path).toBe("/internal/v1/staff-invitations/pending");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ email: "ana@example.com" });
  });

  it("a session without a verified address has no invitation, and asks nobody", async () => {
    const { client, requests } = makeFakeIdentityClient(() => ({ status: 500, body: {} }));
    const service = new StaffInvitationService(client, {} as SessionService);
    expect(await service.pending(session(null))).toEqual({ invitation: null });
    expect(requests).toHaveLength(0);
  });

  it("accepts with the session's own identity and address, and binds the session to the account", async () => {
    const setSomnusUserId = vi.fn().mockResolvedValue(undefined);
    const { client, requests } = makeFakeIdentityClient(() => ({
      status: 200,
      body: { userId: ACTOR, email: "ana@example.com", locale: "es", status: "active" },
    }));
    const service = new StaffInvitationService(client, {
      setSomnusUserId,
    } as unknown as SessionService);
    const active = session("ana@example.com");

    await service.accept(active);

    expect(requests[0]?.path).toBe("/internal/v1/staff-invitations/accept");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      providerUserId: "firebase-uid-1",
      email: "ana@example.com",
    });
    expect(setSomnusUserId).toHaveBeenCalledWith(active.sessionId, ACTOR);
  });
});
