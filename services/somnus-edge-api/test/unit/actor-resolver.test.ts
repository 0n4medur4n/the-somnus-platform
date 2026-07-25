import { SomnusError } from "@somnus/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActorResolver } from "../../src/modules/sessions/actor-resolver.service.js";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";
import { makeFakeIdentityClient } from "../support/fake-identity.js";

const ACTOR = "018f0000-0000-7000-8000-000000000abc";

function sessionWith(somnusUserId: string | null): SessionRecord {
  return {
    sessionId: "018f0000-0000-7000-8000-000000000001",
    firebaseUid: "firebase-uid-1",
    email: "u@example.com",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    somnusUserId,
  };
}

describe("ActorResolver", () => {
  let setSomnusUserId: ReturnType<typeof vi.fn>;
  let sessions: SessionService;

  beforeEach(() => {
    setSomnusUserId = vi.fn().mockResolvedValue(undefined);
    sessions = { setSomnusUserId } as unknown as SessionService;
  });

  it("resolves via identity and memoizes the id on the session", async () => {
    const { client, requests } = makeFakeIdentityClient((req) => {
      expect(req.path).toBe("/internal/v1/users/resolve");
      expect(JSON.parse(req.body ?? "{}")).toEqual({ providerUserId: "firebase-uid-1" });
      return {
        status: 200,
        body: { userId: ACTOR, email: "u@example.com", locale: "es", status: "active" },
      };
    });
    const resolver = new ActorResolver(client, sessions);

    const id = await resolver.resolve(sessionWith(null), "corr-1");

    expect(id).toBe(ACTOR);
    expect(requests).toHaveLength(1);
    expect(setSomnusUserId).toHaveBeenCalledWith("018f0000-0000-7000-8000-000000000001", ACTOR);
  });

  it("short-circuits when the id is already memoized (no identity call)", async () => {
    const { client, requests } = makeFakeIdentityClient(() => {
      throw new Error("should not be called");
    });
    const resolver = new ActorResolver(client, sessions);

    const id = await resolver.resolve(sessionWith(ACTOR), "corr-1");

    expect(id).toBe(ACTOR);
    expect(requests).toHaveLength(0);
    expect(setSomnusUserId).not.toHaveBeenCalled();
  });

  it("propagates identity's 404 as a NOT_FOUND SomnusError", async () => {
    const { client } = makeFakeIdentityClient(() => ({
      status: 404,
      body: { error: { code: "NOT_FOUND", message: "No Somnus account.", correlationId: "x" } },
    }));
    const resolver = new ActorResolver(client, sessions);

    await expect(resolver.resolve(sessionWith(null), "corr-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(setSomnusUserId).not.toHaveBeenCalled();
  });

  it("throws INTERNAL when identity returns an unexpected body shape", async () => {
    const { client } = makeFakeIdentityClient(() => ({ status: 200, body: { nope: true } }));
    const resolver = new ActorResolver(client, sessions);

    await expect(resolver.resolve(sessionWith(null), "corr-1")).rejects.toBeInstanceOf(SomnusError);
    expect(setSomnusUserId).not.toHaveBeenCalled();
  });
});
