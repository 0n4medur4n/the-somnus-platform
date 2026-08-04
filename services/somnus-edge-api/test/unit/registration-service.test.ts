import { describe, expect, it, vi } from "vitest";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { RegistrationService } from "../../src/modules/registration/registration.service.js";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";
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

function meBody() {
  return {
    user: { id: ACTOR, email: "u@example.com", locale: "es", status: "active" },
    individualProfile: { firstName: "Ada", lastName: "Lovelace" },
    professionalProfile: null,
  };
}

describe("RegistrationService", () => {
  it("provisions with the session identity, memoizes the id, and returns /v1/me", async () => {
    const setSomnusUserId = vi.fn().mockResolvedValue(undefined);
    const sessions = { setSomnusUserId } as unknown as SessionService;
    const { client, requests } = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/users/provision") {
        expect(JSON.parse(req.body ?? "{}")).toEqual({
          providerUserId: "firebase-uid-1",
          email: "u@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          locale: "ca",
        });
        return {
          status: 200,
          body: { userId: ACTOR, email: "u@example.com", locale: "ca", status: "active" },
        };
      }
      expect(req.path).toBe("/v1/me");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body: meBody() };
    });
    const service = new RegistrationService(client, sessions);

    const result = await service.register(
      session("u@example.com"),
      { firstName: "Ada", lastName: "Lovelace", locale: "ca" },
      "corr-1",
    );

    expect(result).toMatchObject({ individualProfile: { firstName: "Ada" } });
    expect(setSomnusUserId).toHaveBeenCalledWith("018f0000-0000-7000-8000-000000000001", ACTOR);
    expect(requests.map((r) => r.path)).toEqual(["/internal/v1/users/provision", "/v1/me"]);
  });

  it("rejects when the session has no email (email-link identity is required)", async () => {
    const sessions = { setSomnusUserId: vi.fn() } as unknown as SessionService;
    const { client, requests } = makeFakeIdentityClient(() => ({ status: 200, body: {} }));
    const service = new RegistrationService(client, sessions);

    await expect(
      service.register(session(null), { firstName: "A", lastName: "B" }, "corr-1"),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(requests).toHaveLength(0);
  });

  it("throws INTERNAL when provision returns an unexpected shape", async () => {
    const sessions = { setSomnusUserId: vi.fn() } as unknown as SessionService;
    const { client } = makeFakeIdentityClient(() => ({ status: 200, body: { nope: true } }));
    const service = new RegistrationService(client, sessions);

    await expect(
      service.register(session("u@example.com"), { firstName: "A", lastName: "B" }, "corr-1"),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("propagates a downstream conflict from provision", async () => {
    const sessions = { setSomnusUserId: vi.fn() } as unknown as SessionService;
    const { client } = makeFakeIdentityClient(() => ({
      status: 409,
      body: { error: { code: "CONFLICT", message: "dup", correlationId: "x" } },
    }));
    const service = new RegistrationService(client, sessions);

    await expect(
      service.register(session("u@example.com"), { firstName: "A", lastName: "B" }, "corr-1"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
