import type { ExecutionContext } from "@nestjs/common";
import { SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import { SessionGuard } from "../../src/modules/sessions/session.guard.js";
import type { SessionRecord, SessionService } from "../../src/modules/sessions/session.service.js";

type FakeRequest = {
  cookies: Record<string, string | undefined>;
  correlationId?: string;
  unsignCookie: (value: string) => { valid: boolean; renew: boolean; value: string | null };
  session?: SessionRecord;
};

function contextFor(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function guardWith(validate: SessionService["validate"]): SessionGuard {
  return new SessionGuard({ validate } as unknown as SessionService);
}

const NEVER_VALIDATE: SessionService["validate"] = async () => {
  throw new Error("validate() should not be called on an early rejection");
};

describe("SessionGuard", () => {
  it("throws UNAUTHENTICATED when there is no session cookie", async () => {
    const guard = guardWith(NEVER_VALIDATE);
    const req: FakeRequest = {
      cookies: {},
      unsignCookie: () => ({ valid: false, renew: false, value: null }),
    };
    await expect(guard.canActivate(contextFor(req))).rejects.toSatisfy(
      (e: unknown) => e instanceof SomnusError && e.code === "UNAUTHENTICATED",
    );
  });

  it("throws UNAUTHENTICATED when the cookie signature is invalid (tampered)", async () => {
    const guard = guardWith(NEVER_VALIDATE);
    const req: FakeRequest = {
      cookies: { somnus_session: "tampered.value" },
      unsignCookie: () => ({ valid: false, renew: false, value: null }),
    };
    await expect(guard.canActivate(contextFor(req))).rejects.toSatisfy(
      (e: unknown) => e instanceof SomnusError && e.code === "UNAUTHENTICATED",
    );
  });

  it("throws UNAUTHENTICATED when the session is not found/valid in the store", async () => {
    const guard = guardWith(async () => null);
    const req: FakeRequest = {
      cookies: { somnus_session: "signed.value" },
      unsignCookie: () => ({ valid: true, renew: false, value: "session-id" }),
    };
    await expect(guard.canActivate(contextFor(req))).rejects.toSatisfy(
      (e: unknown) => e instanceof SomnusError && e.code === "UNAUTHENTICATED",
    );
  });

  it("allows and attaches the session when the cookie is valid and the session is active", async () => {
    const record: SessionRecord = {
      sessionId: "session-id",
      firebaseUid: "uid-1",
      email: "u@example.com",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      revokedAt: null,
    };
    const guard = guardWith(async () => record);
    const req: FakeRequest = {
      cookies: { somnus_session: "signed.value" },
      unsignCookie: () => ({ valid: true, renew: false, value: "session-id" }),
    };
    const allowed = await guard.canActivate(contextFor(req));
    expect(allowed).toBe(true);
    expect(req.session).toEqual(record);
  });
});
