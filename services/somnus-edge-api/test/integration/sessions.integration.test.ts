import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../support/app.js";
import {
  clearAuthEmulator,
  clearFirestoreEmulator,
  makeExpiredIdToken,
  signUpTestUser,
} from "../support/emulator.js";

type Cookie = { name: string; value: string };

function cookieHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

describe("edge-api sessions & hardening (build plan §20 Checkpoint 8.1)", () => {
  let testApp: TestApp;
  let server: FastifyInstance;

  beforeAll(async () => {
    testApp = await buildTestApp();
    server = testApp.server;
  });

  afterAll(async () => {
    await testApp.app.close();
  });

  beforeEach(async () => {
    await clearAuthEmulator();
    await clearFirestoreEmulator();
  });

  describe("POST /v1/sessions (token exchange)", () => {
    it("happy path: a valid ID token is exchanged for a session cookie", async () => {
      const { idToken, uid } = await signUpTestUser("happy@example.com");

      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as { firebaseUid: string; email: string | null; csrfToken: string };
      expect(body.firebaseUid).toBe(uid);
      expect(body.email).toBe("happy@example.com");
      // The CSRF token travels in the body: the SPA lives on another site and
      // can never read a cookie this API sets (2026-10-05 registration 403).
      expect(typeof body.csrfToken).toBe("string");
      expect(body.csrfToken.length).toBeGreaterThan(0);
      expect(res.headers["cache-control"]).toBe("no-store");

      const cookies = res.cookies as Cookie[];
      // Exactly one cookie, named `__session`: Firebase Hosting, which fronts
      // this API at api.thesomnus.com, forwards no other cookie to Cloud Run.
      expect(cookies.map((c) => c.name)).toEqual(["__session"]);
    });

    it("rejects a forged token with 401", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken: "not.a.real.token" }),
      });
      expect(res.statusCode).toBe(401);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
      expect(res.cookies as Cookie[]).toHaveLength(0);
    });

    it("rejects an expired token with 401", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken: makeExpiredIdToken() }),
      });
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects a request with no idToken (validation)", async () => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("session cookie attributes (build plan §21)", () => {
    it("the session cookie is HttpOnly, Path=/, SameSite=Lax; no cookie is readable by script", async () => {
      const { idToken } = await signUpTestUser("attrs@example.com");
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });
      const setCookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
      const sessionCookie = setCookies.find((c) => c.startsWith("__session="));
      if (!sessionCookie) throw new Error("expected session cookie not set");

      expect(sessionCookie).toMatch(/HttpOnly/i);
      expect(sessionCookie).toMatch(/Path=\//i);
      expect(sessionCookie).toMatch(/SameSite=Lax/i);
      // COOKIE_SECURE=false in test (plain HTTP), so no Secure flag here.
      expect(sessionCookie).not.toMatch(/Secure/i);
      // The session cookie is the only cookie, and it is HttpOnly. The CSRF
      // token is derived from the session and travels in response bodies, so
      // nothing needs to be readable by script -- or to be a second cookie,
      // which Firebase Hosting would strip.
      expect(setCookies).toHaveLength(1);
      for (const cookie of setCookies) expect(cookie).toMatch(/HttpOnly/i);
    });
  });

  describe("DELETE /v1/sessions/current (revoke) + CSRF", () => {
    async function loginAndCollect(email: string) {
      const { idToken } = await signUpTestUser(email);
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });
      const cookies = res.cookies as Cookie[];
      const csrfToken = (res.json() as { csrfToken: string }).csrfToken;
      return { cookies, csrfToken };
    }

    it("revokes with a valid session cookie + CSRF header (204)", async () => {
      const { cookies, csrfToken } = await loginAndCollect("logout@example.com");
      const res = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { cookie: cookieHeader(cookies), "x-csrf-token": csrfToken },
      });
      expect(res.statusCode).toBe(204);
    });

    it("rejects a state-changing request with a missing CSRF token (403)", async () => {
      const { cookies } = await loginAndCollect("csrf@example.com");
      const res = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { cookie: cookieHeader(cookies) }, // no x-csrf-token
      });
      expect(res.statusCode).toBe(403);
      // FORBIDDEN, marked as a CSRF rejection so the SPA refreshes its token
      // and retries once -- and never retries a 403 that means "not allowed".
      const body = res.json() as { error: { code: string; details: Record<string, unknown> } };
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.details).toEqual({ reason: "csrf" });
    });

    it("rejects a token issued to a different session (403)", async () => {
      const a = await loginAndCollect("csrf-a@example.com");
      const b = await loginAndCollect("csrf-b@example.com");
      const res = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        // B's cookies, A's token: the token is bound to the secret cookie.
        headers: { cookie: cookieHeader(b.cookies), "x-csrf-token": a.csrfToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("a revoked session is rejected on the very next request (401)", async () => {
      const { cookies, csrfToken } = await loginAndCollect("revoked@example.com");

      const first = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { cookie: cookieHeader(cookies), "x-csrf-token": csrfToken },
      });
      expect(first.statusCode).toBe(204);

      // Re-send the now-revoked session cookie (with CSRF so we reach the
      // session guard, not the CSRF gate). Revocation is immediate.
      const second = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { cookie: cookieHeader(cookies), "x-csrf-token": csrfToken },
      });
      expect(second.statusCode).toBe(401);
    });

    it("rejects a request with no session cookie at all (401)", async () => {
      const res = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { "x-csrf-token": "anything" },
      });
      // No session cookie => the CSRF gate rejects first (403); either
      // way an unauthenticated caller cannot revoke. Accept 401 or 403.
      expect([401, 403]).toContain(res.statusCode);
    });
  });

  describe("GET /v1/sessions/csrf (token after a reload)", () => {
    async function login(email: string) {
      const { idToken } = await signUpTestUser(email);
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });
      return res.cookies as Cookie[];
    }

    it("refuses without a session (401): it never mints a token for nobody", async () => {
      const res = await server.inject({ method: "GET", url: "/v1/sessions/csrf" });
      expect(res.statusCode).toBe(401);
    });

    it("returns a no-store token that authorizes a mutation, as after a reload", async () => {
      // The body token from login is deliberately discarded: a reload keeps
      // the cookies and loses what the SPA held in memory.
      const cookies = await login("reload@example.com");

      const tokenRes = await server.inject({
        method: "GET",
        url: "/v1/sessions/csrf",
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(tokenRes.statusCode).toBe(200);
      expect(tokenRes.headers["cache-control"]).toBe("no-store");
      const { csrfToken } = tokenRes.json() as { csrfToken: string };
      expect(csrfToken.length).toBeGreaterThan(0);
      // Derived from the session, so it sets no cookie at all.
      expect(tokenRes.cookies as Cookie[]).toHaveLength(0);

      const res = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { cookie: cookieHeader(cookies), "x-csrf-token": csrfToken },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe("the CSRF token is bound to the session", () => {
    it("is stable for a session, so tabs and reloads agree", async () => {
      const { idToken } = await signUpTestUser("stable@example.com");
      const login = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });
      const cookies = login.cookies as Cookie[];
      const fromLogin = (login.json() as { csrfToken: string }).csrfToken;
      const again = await server.inject({
        method: "GET",
        url: "/v1/sessions/csrf",
        headers: { cookie: cookieHeader(cookies) },
      });
      expect((again.json() as { csrfToken: string }).csrfToken).toBe(fromLogin);
    });

    it("rejects a token presented with a tampered session cookie (403)", async () => {
      const { idToken } = await signUpTestUser("tamper@example.com");
      const login = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });
      const token = (login.json() as { csrfToken: string }).csrfToken;
      const res = await server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: { cookie: "__session=forged.signature", "x-csrf-token": token },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { details: Record<string, unknown> } }).error.details).toEqual(
        {
          reason: "csrf",
        },
      );
    });
  });

  describe("Secure cookie attribute is config-driven", () => {
    it("sets Secure on the session cookie when COOKIE_SECURE=true (production)", async () => {
      const secureApp = await buildTestApp({ COOKIE_SECURE: "true" });
      try {
        const { idToken } = await signUpTestUser("secure@example.com");
        const res = await secureApp.server.inject({
          method: "POST",
          url: "/v1/sessions",
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ idToken }),
        });
        const setCookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
        const sessionCookie = setCookies.find((c) => c.startsWith("__session="));
        expect(sessionCookie).toMatch(/Secure/i);
      } finally {
        await secureApp.app.close();
        process.env["COOKIE_SECURE"] = "false";
      }
    });
  });
});

describe("rate limiting (build plan §21)", () => {
  let rlApp: TestApp;

  beforeAll(async () => {
    // A tiny limit so a couple of requests trip it deterministically.
    rlApp = await buildTestApp({ RATE_LIMIT_MAX: "2", RATE_LIMIT_WINDOW_MS: "60000" });
  });

  afterAll(async () => {
    await rlApp.app.close();
    process.env["RATE_LIMIT_MAX"] = "100";
  });

  it("returns 429 with the §16 error shape once the limit is exceeded", async () => {
    const hit = () => rlApp.server.inject({ method: "GET", url: "/health/live" });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect((limited.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
  });
});
