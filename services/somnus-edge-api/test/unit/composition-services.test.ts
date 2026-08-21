import { UUIDv7 } from "@somnus/api-contracts";
import { createCloudRunClient } from "@somnus/cloud-run-client";
import { describe, expect, it } from "vitest";
import { ACTOR_ID_HEADER } from "../../src/infrastructure/internal-clients/headers.js";
import { ConsentProxyService } from "../../src/modules/consent/consent.service.js";
import { MeService } from "../../src/modules/me/me.service.js";
import type { ActorResolver } from "../../src/modules/sessions/actor-resolver.service.js";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SESSION = {
  sessionId: "s1",
  firebaseUid: "f1",
  somnusUserId: ACTOR,
} as unknown as SessionRecord;

/** A resolver that skips the identity round-trip (covered in actor-resolver.test). */
const fakeResolver = { resolve: async () => ACTOR } as unknown as ActorResolver;

/** Morpheo + session collaborators are unused by getMe/patchProfile; deleteAccount drives its own. */
const { client: unusedMorpheo } = makeFakeIdentityClient(() => ({ status: 204 }));
const noopSessions = { revoke: async () => undefined } as unknown as SessionService;

const FAST_RETRY = {
  maxAttempts: 3,
  initialDelayMs: 1,
  maxDelayMs: 5,
  backoffMultiplier: 2,
  jitter: false,
};

function meResponse() {
  return {
    user: { id: UUIDv7(), email: "u@example.com", locale: "es", status: "active" },
    individualProfile: null,
    professionalProfile: null,
  };
}

describe("MeService (composition)", () => {
  it("forwards the actor id and returns the identity /v1/me body", async () => {
    const body = meResponse();
    const { client, requests } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/me");
      expect(req.method).toBe("GET");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body };
    });
    const service = new MeService(client, unusedMorpheo, fakeResolver, noopSessions);

    const result = await service.getMe(SESSION, "corr-1");

    expect(result).toEqual(body);
    expect(requests).toHaveLength(1);
  });

  it("PATCHes the profile through identity with the actor id and body", async () => {
    const { client, requests } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/me/profile");
      expect(req.method).toBe("PATCH");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      expect(JSON.parse(req.body ?? "{}")).toEqual({ firstName: "Ada" });
      return { status: 204 };
    });
    const service = new MeService(client, unusedMorpheo, fakeResolver, noopSessions);

    await expect(
      service.patchProfile(SESSION, { firstName: "Ada" }, "corr-1"),
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
  });

  it("throws INTERNAL when identity returns an unexpected /v1/me body", async () => {
    const { client } = makeFakeIdentityClient(() => ({ status: 200, body: { bogus: true } }));
    const service = new MeService(client, unusedMorpheo, fakeResolver, noopSessions);

    await expect(service.getMe(SESSION, "corr-1")).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("maps a downstream 403 to a FORBIDDEN SomnusError", async () => {
    const { client } = makeFakeIdentityClient(() => ({
      status: 403,
      body: { error: { code: "FORBIDDEN", message: "no", correlationId: "x" } },
    }));
    const service = new MeService(client, unusedMorpheo, fakeResolver, noopSessions);

    await expect(service.getMe(SESSION, "corr-1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("erases morpheo assessments, deletes the identity account, then revokes the session", async () => {
    const morpheo = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/internal/v1/maintenance/user-assessments/delete");
      expect(req.method).toBe("POST");
      expect(JSON.parse(req.body ?? "{}")).toEqual({ userId: ACTOR });
      return { status: 200, body: { deleted: 1 } };
    });
    const identity = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/me");
      expect(req.method).toBe("DELETE");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 204 };
    });
    const revoked: string[] = [];
    const sessions = {
      revoke: async (id: string) => {
        revoked.push(id);
      },
    } as unknown as SessionService;
    const service = new MeService(identity.client, morpheo.client, fakeResolver, sessions);

    await expect(service.deleteAccount(SESSION, "corr-1")).resolves.toBeUndefined();

    expect(morpheo.requests).toHaveLength(1);
    expect(identity.requests).toHaveLength(1);
    expect(revoked).toEqual(["s1"]);
  });
});

describe("MeService timeout/retry behavior", () => {
  it("retries a retriable 503 and then succeeds", async () => {
    let calls = 0;
    const body = meResponse();
    const { client, requests } = makeFakeIdentityClient(
      () => {
        calls += 1;
        return calls === 1 ? { status: 503, body: {} } : { status: 200, body };
      },
      { retry: FAST_RETRY },
    );
    const service = new MeService(client, unusedMorpheo, fakeResolver, noopSessions);

    const result = await service.getMe(SESSION, "corr-1");

    expect(result).toEqual(body);
    expect(requests).toHaveLength(2);
  });

  it("surfaces a timeout as UPSTREAM_UNAVAILABLE", async () => {
    const client = createCloudRunClient({
      baseUrl: "http://identity.internal",
      tokenProvider: { getIdToken: async () => "t" },
      defaultTimeoutMs: 50,
      retry: { ...FAST_RETRY, maxAttempts: 1 },
      transport: ({ init }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Timeout", "TimeoutError")),
            { once: true },
          );
        }),
    });
    const service = new MeService(client, unusedMorpheo, fakeResolver, noopSessions);

    await expect(service.getMe(SESSION, "corr-1")).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });
});

describe("ConsentProxyService (composition)", () => {
  it("reads legal documents publicly and forwards the locale query", async () => {
    const { client, requests } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/legal-documents/current");
      expect(req.url).toContain("locale=ca");
      return { status: 200, body: { documents: [] } };
    });
    const service = new ConsentProxyService(client, fakeResolver);

    const result = await service.getLegalDocuments("ca", "corr-1");

    expect(result).toEqual({ documents: [] });
    expect(requests).toHaveLength(1);
  });

  it("omits the locale query when no locale is given", async () => {
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.url).not.toContain("locale=");
      return { status: 200, body: { documents: [] } };
    });
    const service = new ConsentProxyService(client, fakeResolver);
    await service.getLegalDocuments(undefined, "corr-1");
  });

  it("gets the actor's current consent standing", async () => {
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/consents/current");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 200, body: { purposes: [] } };
    });
    const service = new ConsentProxyService(client, fakeResolver);

    expect(await service.getCurrent(SESSION, "corr-1")).toEqual({ purposes: [] });
  });

  it("records consent, forwarding actor and body, returning the receipt", async () => {
    const receipt = {
      id: UUIDv7(),
      userId: ACTOR,
      purposeKey: "health_data_processing",
      legalDocumentVersionId: UUIDv7(),
      source: "app",
      consentedAt: new Date().toISOString(),
    };
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/consents");
      expect(req.method).toBe("POST");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      expect(JSON.parse(req.body ?? "{}")).toMatchObject({ purposeKey: "health_data_processing" });
      return { status: 201, body: receipt };
    });
    const service = new ConsentProxyService(client, fakeResolver);

    const result = await service.record(
      SESSION,
      { purposeKey: "health_data_processing", source: "app" },
      "corr-1",
    );
    expect(result).toMatchObject({ purposeKey: "health_data_processing", userId: ACTOR });
  });

  it("withdraws consent by receipt id (path-encoded, 204, no body returned)", async () => {
    const { client } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/v1/consents/receipt-42/withdraw");
      expect(req.method).toBe("POST");
      expect(req.headers[ACTOR_ID_HEADER]).toBe(ACTOR);
      return { status: 204 };
    });
    const service = new ConsentProxyService(client, fakeResolver);

    await expect(
      service.withdraw(SESSION, "receipt-42", { reason: "changed my mind" }, "corr-1"),
    ).resolves.toBeUndefined();
  });

  it("throws INTERNAL when identity returns an unexpected receipt shape", async () => {
    const { client } = makeFakeIdentityClient(() => ({ status: 201, body: { nope: true } }));
    const service = new ConsentProxyService(client, fakeResolver);

    await expect(
      service.record(SESSION, { purposeKey: "health_data_processing", source: "app" }, "corr-1"),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
