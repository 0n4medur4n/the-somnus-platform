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

function findCookie(cookies: Cookie[], name: string): Cookie | undefined {
  return cookies.find((c) => c.name === name);
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
      const body = res.json() as { firebaseUid: string; email: string | null };
      expect(body.firebaseUid).toBe(uid);
      expect(body.email).toBe("happy@example.com");

      const cookies = res.cookies as Cookie[];
      expect(findCookie(cookies, "somnus_session")).toBeDefined();
      // The CSRF token cookie is issued so the SPA can echo it in a header.
      expect(findCookie(cookies, "somnus_csrf")).toBeDefined();
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
    it("the session cookie is HttpOnly, Path=/, SameSite=Lax; the CSRF token cookie is readable", async () => {
      const { idToken } = await signUpTestUser("attrs@example.com");
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ idToken }),
      });
      const setCookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
      const sessionCookie = setCookies.find((c) => c.startsWith("somnus_session="));
      const csrfTokenCookie = setCookies.find((c) => c.startsWith("somnus_csrf="));
      if (!sessionCookie || !csrfTokenCookie) throw new Error("expected cookies not set");

      expect(sessionCookie).toMatch(/HttpOnly/i);
      expect(sessionCookie).toMatch(/Path=\//i);
      expect(sessionCookie).toMatch(/SameSite=Lax/i);
      // COOKIE_SECURE=false in test (plain HTTP), so no Secure flag here.
      expect(sessionCookie).not.toMatch(/Secure/i);
      // The token cookie must be readable by the SPA (not HttpOnly).
      expect(csrfTokenCookie).not.toMatch(/HttpOnly/i);
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
      const csrfToken = findCookie(cookies, "somnus_csrf")?.value ?? "";
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
      // No _csrf secret cookie => CSRF gate rejects first (403); either
      // way an unauthenticated caller cannot revoke. Accept 401 or 403.
      expect([401, 403]).toContain(res.statusCode);
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
        const sessionCookie = setCookies.find((c) => c.startsWith("somnus_session="));
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
