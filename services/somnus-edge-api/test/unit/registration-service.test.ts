import { describe, expect, it, vi } from "vitest";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { RegistrationService } from "../../src/modules/registration/registration.service.js";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION_ID = "018f0000-0000-7000-8000-000000000001";
/** Both purposes are always sent as separate flags -- never one combined value (build plan §13). */
const CONSENTS = { termsAcceptance: true, privacyPolicyAcknowledgement: true } as const;

function session(email: string | null): SessionRecord {
  return {
    sessionId: SESSION_ID,
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

function provisionOk(locale = "es") {
  return {
    status: 200,
    body: { userId: ACTOR, email: "u@example.com", locale, status: "active" },
  };
}

function sessionsStub(): SessionService {
  return { setSomnusUserId: vi.fn().mockResolvedValue(undefined) } as unknown as SessionService;
}

/** Captures the exact JSON body the edge forwards to the provision endpoint. */
function captureProvision() {
  const captured: { body?: Record<string, unknown> } = {};
  const { client, requests } = makeFakeIdentityClient((req) => {
    if (req.path === "/internal/v1/users/provision") {
      captured.body = JSON.parse(req.body ?? "{}") as Record<string, unknown>;
      return provisionOk();
    }
    return { status: 200, body: meBody() };
  });
  return { client, requests, captured };
}

describe("RegistrationService", () => {
  it("provisions with the session identity, memoizes the id, and returns /v1/me", async () => {
    const setSomnusUserId = vi.fn().mockResolvedValue(undefined);
    const sessions = { setSomnusUserId } as unknown as SessionService;
    const { client, requests } = makeFakeIdentityClient((req) => {
      if (req.path === "/internal/v1/users/provision") {
        expect(JSON.parse(req.body ?? "{}")).toEqual({
          role: "adult",
          ageYears: 34,
          firstName: "Ada",
          lastName: "Lovelace",
          locale: "ca",
          consents: CONSENTS,
          providerUserId: "firebase-uid-1",
          email: "u@example.com",
        });
        return provisionOk("ca");
      }
      expect(req.path).toBe("/v1/me");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body: meBody() };
    });
    const service = new RegistrationService(client, sessions);

    const result = await service.register(
      session("u@example.com"),
      {
        role: "adult",
        ageYears: 34,
        firstName: "Ada",
        lastName: "Lovelace",
        locale: "ca",
        consents: CONSENTS,
      },
      "corr-1",
    );

    expect(result).toMatchObject({ individualProfile: { firstName: "Ada" } });
    expect(setSomnusUserId).toHaveBeenCalledWith(SESSION_ID, ACTOR);
    expect(requests.map((r) => r.path)).toEqual(["/internal/v1/users/provision", "/v1/me"]);
  });

  it("rejects when the session has no email (email-link identity is required)", async () => {
    const { client, requests } = makeFakeIdentityClient(() => ({ status: 200, body: {} }));
    const service = new RegistrationService(client, sessionsStub());

    await expect(
      service.register(
        session(null),
        { role: "adult", ageYears: 30, firstName: "A", lastName: "B", consents: CONSENTS },
        "corr-1",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(requests).toHaveLength(0);
  });

  it("throws INTERNAL when provision returns an unexpected shape", async () => {
    const { client } = makeFakeIdentityClient(() => ({ status: 200, body: { nope: true } }));
    const service = new RegistrationService(client, sessionsStub());

    await expect(
      service.register(
        session("u@example.com"),
        { role: "adult", ageYears: 30, firstName: "A", lastName: "B", consents: CONSENTS },
        "corr-1",
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("propagates a downstream conflict from provision", async () => {
    const { client } = makeFakeIdentityClient(() => ({
      status: 409,
      body: { error: { code: "CONFLICT", message: "dup", correlationId: "x" } },
    }));
    const service = new RegistrationService(client, sessionsStub());

    await expect(
      service.register(
        session("u@example.com"),
        { role: "adult", ageYears: 30, firstName: "A", lastName: "B", consents: CONSENTS },
        "corr-1",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

/**
 * REGRESSION (Addendum A, Checkpoint 14.1). The edge used to build the provision
 * body field by field and silently dropped the entire role branch: `role`,
 * `consents` and every branch-specific field never reached identity, so a
 * professional or a guardian was provisioned as a bare individual while the
 * request still returned 200. Asserting the status code would NOT have caught
 * that. These tests assert the forwarded body FIELD BY FIELD, per branch, so a
 * silent drop or a silent default fails loudly instead of degrading the data.
 */
describe("RegistrationService forwards the whole role branch (silent-drop regression)", () => {
  it("professional branch: role, specialty, licenseNumber and both consents arrive intact", async () => {
    const { client, captured } = captureProvision();
    const service = new RegistrationService(client, sessionsStub());

    await service.register(
      session("u@example.com"),
      {
        role: "professional",
        firstName: "Grace",
        lastName: "Hopper",
        locale: "es",
        specialty: "sleep_physician",
        licenseNumber: "COL-12345",
        consents: CONSENTS,
      },
      "corr-1",
    );

    const body = captured.body ?? {};
    expect(body.role).toBe("professional");
    expect(body.specialty).toBe("sleep_physician");
    expect(body.licenseNumber).toBe("COL-12345");
    expect(body.consents).toEqual(CONSENTS);
    expect(body.firstName).toBe("Grace");
    expect(body.lastName).toBe("Hopper");
    expect(body.locale).toBe("es");
    // Identity fields come from the verified session, never from the client.
    expect(body.providerUserId).toBe("firebase-uid-1");
    expect(body.email).toBe("u@example.com");
  });

  it("parent branch: guardianshipConfirmed and minorAgeBand arrive intact", async () => {
    const { client, captured } = captureProvision();
    const service = new RegistrationService(client, sessionsStub());

    await service.register(
      session("u@example.com"),
      {
        role: "parent",
        firstName: "Marie",
        lastName: "Curie",
        locale: "ca",
        guardianshipConfirmed: true,
        minorAgeBand: "6-12y",
        consents: CONSENTS,
      },
      "corr-1",
    );

    const body = captured.body ?? {};
    expect(body.role).toBe("parent");
    expect(body.guardianshipConfirmed).toBe(true);
    expect(body.minorAgeBand).toBe("6-12y");
    expect(body.consents).toEqual(CONSENTS);
    expect(body.firstName).toBe("Marie");
    expect(body.lastName).toBe("Curie");
    expect(body.locale).toBe("ca");
    expect(body.providerUserId).toBe("firebase-uid-1");
    expect(body.email).toBe("u@example.com");
  });

  it("adult branch: ageYears arrives intact", async () => {
    const { client, captured } = captureProvision();
    const service = new RegistrationService(client, sessionsStub());

    await service.register(
      session("u@example.com"),
      {
        role: "adult",
        firstName: "Alan",
        lastName: "Turing",
        locale: "en",
        ageYears: 41,
        consents: CONSENTS,
      },
      "corr-1",
    );

    const body = captured.body ?? {};
    expect(body.role).toBe("adult");
    expect(body.ageYears).toBe(41);
    expect(body.consents).toEqual(CONSENTS);
    expect(body.firstName).toBe("Alan");
    expect(body.lastName).toBe("Turing");
    expect(body.locale).toBe("en");
    expect(body.providerUserId).toBe("firebase-uid-1");
    expect(body.email).toBe("u@example.com");
  });
});
