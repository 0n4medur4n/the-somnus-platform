import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, type TestApp } from "../support/app.js";
import { clearAuthEmulator, clearFirestoreEmulator, signUpTestUser } from "../support/emulator.js";

/**
 * The session cookie as a deployed service issues it, and secret rotation.
 *
 * These run the real app under the settings Terraform gives the live service
 * (NODE_ENV=production, COOKIE_SECURE=true, SameSite lax, a strong secret), not
 * the relaxed ones the rest of the suite uses for plain HTTP.
 */

const secret = () => randomBytes(24).toString("base64url");

const KEYS = [
  "NODE_ENV",
  "COOKIE_SECRET",
  "COOKIE_SECRET_PREVIOUS",
  "COOKIE_SECURE",
  "COOKIE_SAMESITE",
] as const;

function production(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: "production",
    COOKIE_SECRET: secret(),
    COOKIE_SECURE: "true",
    COOKIE_SAMESITE: "lax",
    ...overrides,
  };
}

/** What @fastify/cookie writes: value, a dot, then HMAC-SHA256 in base64 without padding. */
function signature(value: string, key: string): string {
  return createHmac("sha256", key).update(value).digest("base64").replace(/=+$/, "");
}

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  return ([] as string[]).concat(
    (res.headers["set-cookie"] as string | string[] | undefined) ?? [],
  );
}

describe("session cookie as deployed", () => {
  const saved = new Map<string, string | undefined>();
  const apps: TestApp[] = [];

  beforeEach(async () => {
    for (const key of KEYS) saved.set(key, process.env[key]);
    await clearAuthEmulator();
    await clearFirestoreEmulator();
  });

  afterEach(async () => {
    for (const app of apps.splice(0)) await app.app.close();
    for (const key of KEYS) {
      const before = saved.get(key);
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    }
  });

  async function boot(overrides: Record<string, string>): Promise<TestApp> {
    // buildTestApp writes the overrides into process.env; keys left out must not
    // leak in from an earlier boot of this file.
    for (const key of KEYS) if (!(key in overrides)) delete process.env[key];
    const app = await buildTestApp(overrides);
    apps.push(app);
    return app;
  }

  async function login(app: TestApp, email: string) {
    const { idToken } = await signUpTestUser(email);
    const res = await app.server.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ idToken }),
    });
    expect(res.statusCode).toBe(201);
    const header = setCookies(res).find((c) => c.startsWith("__session="));
    if (!header) throw new Error("no session cookie");
    const value = decodeURIComponent((header.split(";")[0] ?? "").slice("__session=".length));
    return {
      header,
      value,
      sessionId: value.slice(0, value.lastIndexOf(".")),
      signed: value.slice(value.lastIndexOf(".") + 1),
      csrfToken: (res.json() as { csrfToken: string }).csrfToken,
    };
  }

  const csrf = (app: TestApp, cookie: string) =>
    app.server.inject({
      method: "GET",
      url: "/v1/sessions/csrf",
      headers: { cookie: `__session=${encodeURIComponent(cookie)}` },
    });

  describe("attributes", () => {
    it("is HttpOnly, Secure, SameSite=Lax, Path=/ and has no Domain", async () => {
      const app = await boot(production());
      const { header } = await login(app, "attrs@example.com");
      expect(header).toMatch(/;\s*HttpOnly/i);
      expect(header).toMatch(/;\s*Secure/i);
      expect(header).toMatch(/;\s*SameSite=Lax/i);
      expect(header).toMatch(/;\s*Path=\/(;|$)/i);
      expect(header).not.toMatch(/Domain=/i);
      expect(header).toMatch(/;\s*Max-Age=\d+/i);
    });

    it("is signed, and is the only cookie", async () => {
      const app = await boot(production());
      const { value } = await login(app, "signed@example.com");
      expect(value).toMatch(/^[^.]+\.[A-Za-z0-9+/]+$/);
    });

    it("keeps the name Firebase Hosting forwards, not a __Host- one it would strip", async () => {
      const app = await boot(production());
      const { header } = await login(app, "name@example.com");
      expect(header.startsWith("__session=")).toBe(true);
      expect(header).not.toMatch(/^__Host-/);
    });

    it("follows COOKIE_SAMESITE (strict is possible, none is refused at startup)", async () => {
      const app = await boot(production({ COOKIE_SAMESITE: "strict" }));
      const { header } = await login(app, "strict@example.com");
      expect(header).toMatch(/;\s*SameSite=Strict/i);
    });

    it("logging out clears the cookie with the same attributes, or the browser keeps it", async () => {
      const app = await boot(production());
      const { value, csrfToken } = await login(app, "logout@example.com");
      const res = await app.server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: {
          cookie: `__session=${encodeURIComponent(value)}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.statusCode).toBe(204);
      const cleared = setCookies(res);
      expect(cleared.length).toBeGreaterThan(0);
      const own = cleared.find((c) => c.startsWith("__session="));
      expect(own).toMatch(/Expires=Thu, 01 Jan 1970/i);
      for (const cookie of cleared) {
        expect(cookie).toMatch(/;\s*Secure/i);
        expect(cookie).toMatch(/;\s*Path=\//i);
        expect(cookie).toMatch(/;\s*SameSite=Lax/i);
        expect(cookie).not.toMatch(/Domain=/i);
      }
    });
  });

  describe("secret rotation", () => {
    it("signs with the current secret only", async () => {
      const current = secret();
      const previous = secret();
      const app = await boot(
        production({ COOKIE_SECRET: current, COOKIE_SECRET_PREVIOUS: previous }),
      );
      const { sessionId, signed } = await login(app, "signs@example.com");
      expect(signed).toBe(signature(sessionId, current));
      expect(signed).not.toBe(signature(sessionId, previous));
    });

    it("keeps a session signed with the retired secret working during the rotation", async () => {
      const oldSecret = secret();
      const before = await boot(production({ COOKIE_SECRET: oldSecret }));
      const session = await login(before, "rotate@example.com");
      expect(session.signed).toBe(signature(session.sessionId, oldSecret));
      await before.app.close();
      apps.splice(apps.indexOf(before), 1);

      const newSecret = secret();
      const during = await boot(
        production({ COOKIE_SECRET: newSecret, COOKIE_SECRET_PREVIOUS: oldSecret }),
      );
      expect((await csrf(during, session.value)).statusCode).toBe(200);

      // A person who signs in during the rotation gets a cookie of the new secret.
      const fresh = await login(during, "fresh@example.com");
      expect(fresh.signed).toBe(signature(fresh.sessionId, newSecret));
      expect((await csrf(during, fresh.value)).statusCode).toBe(200);
    });

    it("a CSRF token minted before the rotation is still accepted during it", async () => {
      const oldSecret = secret();
      const before = await boot(production({ COOKIE_SECRET: oldSecret }));
      const session = await login(before, "token@example.com");
      await before.app.close();
      apps.splice(apps.indexOf(before), 1);

      const during = await boot(
        production({ COOKIE_SECRET: secret(), COOKIE_SECRET_PREVIOUS: oldSecret }),
      );
      const res = await during.server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: {
          cookie: `__session=${encodeURIComponent(session.value)}`,
          "x-csrf-token": session.csrfToken,
        },
      });
      expect(res.statusCode).toBe(204);
    });

    it("once the retired secret is removed, its cookies and tokens stop working", async () => {
      const oldSecret = secret();
      const before = await boot(production({ COOKIE_SECRET: oldSecret }));
      const session = await login(before, "gone@example.com");
      await before.app.close();
      apps.splice(apps.indexOf(before), 1);

      const after = await boot(production({ COOKIE_SECRET: secret() }));
      expect((await csrf(after, session.value)).statusCode).toBe(401);
      const res = await after.server.inject({
        method: "DELETE",
        url: "/v1/sessions/current",
        headers: {
          cookie: `__session=${encodeURIComponent(session.value)}`,
          "x-csrf-token": session.csrfToken,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("a cookie signed with a secret that was never configured is refused", async () => {
      const app = await boot(production());
      const { sessionId } = await login(app, "forged@example.com");
      const forged = `${sessionId}.${signature(sessionId, secret())}`;
      expect((await csrf(app, forged)).statusCode).toBe(401);
    });
  });
});
