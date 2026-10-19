import type { PlatformInvitation } from "@somnus/api-contracts";
import { describe, expect, it, vi } from "vitest";
import type { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { PlatformInvitationService } from "../../src/modules/platform-invitation/platform-invitation.service.js";
import { PlatformInvitationEmailService } from "../../src/modules/platform-invitation/platform-invitation-email.service.js";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const id = "018f0000-0000-7000-8000-000000000001";
const active: SessionRecord = {
  sessionId: id,
  firebaseUid: "firebase-ana",
  email: "ana@example.com",
  emailVerified: true,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60000),
  revokedAt: null,
  somnusUserId: null,
};
const invitation: PlatformInvitation = {
  id,
  firstName: "Ana",
  lastName: "Garcia",
  email: "ana@example.com",
  role: "adult",
  locale: "es",
  invitedBy: id,
  status: "pending",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  acceptedAt: null,
};
describe("Morpheo invitation trust boundary", () => {
  it("forwards identity exclusively from the session and only binds after success", async () => {
    const { client, requests } = makeFakeIdentityClient(() => ({
      status: 200,
      body: { userId: id, email: active.email, locale: "es", status: "active" },
    }));
    const setSomnusUserId = vi.fn();
    const service = new PlatformInvitationService(client, {
      setSomnusUserId,
    } as unknown as SessionService);
    await service.act(active, { invitationId: id }, true);
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      invitationId: id,
      email: active.email,
      providerUserId: active.firebaseUid,
    });
    expect(setSomnusUserId).toHaveBeenCalledWith(id, id);
    await expect(service.act(undefined, { invitationId: id }, true)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await expect(
      service.act({ ...active, email: null }, { invitationId: id }, false),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([false, undefined])(
    "rejects unverified or legacy email proof (%s)",
    async (emailVerified) => {
      const { client, requests } = makeFakeIdentityClient(() => ({
        status: 200,
        body: invitation,
      }));
      const service = new PlatformInvitationService(client, {} as SessionService);
      await expect(
        service.act({ ...active, emailVerified }, { invitationId: id }, false),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(requests).toHaveLength(0);
    },
  );
  it.each(["es", "en", "ca", "fr"] as const)(
    "queues the selected %s locale and a fixed application callback",
    async (locale) => {
      const enqueue = vi.fn();
      const firebase = {
        generateSignInLink: vi
          .fn()
          .mockResolvedValue("https://firebase.example/link?oobCode=test-only-code"),
      };
      const sender = new PlatformInvitationEmailService(firebase as unknown as FirebaseService, {
        enqueue,
      });
      expect(await sender.send({ ...invitation, locale }, "test")).toBe(true);
      const task = enqueue.mock.calls[0]?.[0];
      expect(task).toMatchObject({
        type: "invitation",
        locale,
        to: active.email,
        params: { organizationName: "Morpheo" },
      });
      const url = new URL(task.link);
      expect(url.searchParams.get("platformInvitation")).toBe(id);
      expect(url.searchParams.get("lng")).toBe(locale);
      expect(url.pathname).toBe("/auth/callback");
    },
  );
  it("reports queue failure without claiming delivery", async () => {
    const sender = new PlatformInvitationEmailService(
      {
        generateSignInLink: vi.fn().mockRejectedValue(new Error("offline")),
      } as unknown as FirebaseService,
      { enqueue: vi.fn() },
    );
    expect(await sender.send(invitation, "test")).toBe(false);
  });
});
