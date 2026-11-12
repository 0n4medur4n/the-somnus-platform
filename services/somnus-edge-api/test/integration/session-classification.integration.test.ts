import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PRODUCTION_CONSOLE_ORIGIN } from "../../src/config/edge-config.js";
import { FirebaseService } from "../../src/infrastructure/firebase/firebase.service.js";
import { EMAIL_LINK_AMR } from "../../src/modules/sessions/classify-session.js";
import { SessionService } from "../../src/modules/sessions/session.service.js";
import { buildTestApp, type TestApp } from "../support/app.js";
import { clearAuthEmulator, clearFirestoreEmulator, signUpTestUser } from "../support/emulator.js";

/**
 * Origin tricks first. The session is created through POST /v1/sessions, the
 * only production path, and the document is what was stored.
 */
const NOT_CONSOLE = [
  "https://console.thesomnus.com.example",
  "https://example.com/console.thesomnus.com",
  "http://console.thesomnus.com",
  "https://console.thesomnus.com:443",
  "https://console.thesomnus.com.",
  "https://Console.thesomnus.com",
  "https://CONSOLE.THESOMNUS.COM",
  " https://console.thesomnus.com",
  "https://console.thesomnus.com ",
  "https://console.thesomnus.com/",
  "https://console.thesomnus.com/auth/callback",
  "null",
  "https://app.thesomnus.com",
  "http://localhost:5174",
] as const;

type Cookie = { name: string; value: string };

function setCookieHeader(res: LightMyRequestResponse): string {
  const headers = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const header = headers.find((item) => item.startsWith("__session="));
  if (!header) throw new Error("no session cookie");
  return header;
}

function signedCookie(res: LightMyRequestResponse): string {
  const cookie = (res.cookies as Cookie[]).find((item) => item.name === "__session");
  if (!cookie) throw new Error("no session cookie");
  return cookie.value;
}

function sessionIdOf(server: FastifyInstance, res: LightMyRequestResponse): string {
  const unsigned = server.unsignCookie(signedCookie(res));
  if (!unsigned.valid || unsigned.value === null) throw new Error("session cookie did not verify");
  return unsigned.value;
}

describe("session classification at creation", () => {
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

  async function clientFor(
    app: TestApp,
    idToken: string,
    headers: Record<string, string | string[]>,
  ): Promise<unknown> {
    const res = await app.server.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "content-type": "application/json", ...headers },
      payload: JSON.stringify({ idToken }),
    });
    expect(res.statusCode).toBe(201);
    const snap = await app.app
      .get(FirebaseService)
      .firestore.collection("sessions")
      .doc(sessionIdOf(app.server, res))
      .get();
    return snap.data()?.["client"];
  }

  it("records app for origin tricks, a null origin, no origin, the app origin and a Referer", async () => {
    const { idToken } = await signUpTestUser("tricks@example.com");
    const wrong: string[] = [];
    for (const origin of NOT_CONSOLE) {
      const client = await clientFor(testApp, idToken, { origin });
      if (client !== "app") wrong.push(`${JSON.stringify(origin)} -> ${String(client)}`);
    }
    const absent = await clientFor(testApp, idToken, {});
    if (absent !== "app") wrong.push(`absent -> ${String(absent)}`);
    const referred = await clientFor(testApp, idToken, {
      referer: `${PRODUCTION_CONSOLE_ORIGIN}/auth/callback`,
      referrer: `${PRODUCTION_CONSOLE_ORIGIN}/auth/callback`,
    });
    if (referred !== "app") wrong.push(`referer -> ${String(referred)}`);
    const doubled = await clientFor(testApp, idToken, {
      origin: [PRODUCTION_CONSOLE_ORIGIN, "https://evil.example"],
    });
    if (doubled !== "app") wrong.push(`two origins -> ${String(doubled)}`);
    expect(wrong).toEqual([]);
  });

  it("records console for the exact console origin and app for the app origin", async () => {
    const { idToken } = await signUpTestUser("console@example.com");
    expect(await clientFor(testApp, idToken, { origin: PRODUCTION_CONSOLE_ORIGIN })).toBe(
      "console",
    );
    expect(await clientFor(testApp, idToken, { origin: "https://app.thesomnus.com" })).toBe("app");
  });

  it("uses a configured local origin exactly, and the production origin is then app", async () => {
    const previous = process.env["CONSOLE_ORIGIN"];
    const localOrigin = "http://localhost:5174";
    let local: TestApp | undefined;
    try {
      local = await buildTestApp({ CONSOLE_ORIGIN: localOrigin });
      const { idToken } = await signUpTestUser("local-console@example.com");
      expect(await clientFor(local, idToken, { origin: localOrigin })).toBe("console");
      expect(await clientFor(local, idToken, { origin: PRODUCTION_CONSOLE_ORIGIN })).toBe("app");
      expect(await clientFor(local, idToken, { origin: `${localOrigin}/` })).toBe("app");
    } finally {
      if (previous === undefined) delete process.env["CONSOLE_ORIGIN"];
      else process.env["CONSOLE_ORIGIN"] = previous;
      await local?.app.close();
    }
  });

  it("writes the new fields once and does not change the cookie or the response body", async () => {
    const { idToken } = await signUpTestUser("recorded@example.com");
    const opened = async (origin: string) => {
      const res = await server.inject({
        method: "POST",
        url: "/v1/sessions",
        headers: { "content-type": "application/json", origin },
        payload: JSON.stringify({ idToken }),
      });
      expect(res.statusCode).toBe(201);
      return res;
    };
    const consoleRes = await opened(PRODUCTION_CONSOLE_ORIGIN);
    const appRes = await opened("https://app.thesomnus.com");

    const consoleBody = consoleRes.json() as Record<string, unknown>;
    const appBody = appRes.json() as Record<string, unknown>;
    expect(Object.keys(consoleBody).sort()).toEqual([
      "csrfToken",
      "email",
      "expiresAt",
      "firebaseUid",
    ]);
    expect(Object.keys(appBody).sort()).toEqual(Object.keys(consoleBody).sort());

    const attributes = (header: string) => header.slice(header.indexOf(";"));
    const consoleCookie = setCookieHeader(consoleRes);
    expect(attributes(consoleCookie)).toBe(attributes(setCookieHeader(appRes)));
    expect(consoleCookie).toMatch(/HttpOnly/i);
    expect(consoleCookie).toMatch(/SameSite=Lax/i);
    expect(consoleCookie).toMatch(/Path=\//i);
    expect(consoleCookie).toMatch(/Max-Age=604800/i);
    expect(consoleCookie).not.toMatch(/Domain=/i);
    expect(consoleCookie).not.toMatch(/Secure/i);

    const id = sessionIdOf(server, consoleRes);
    const firebase = testApp.app.get(FirebaseService).firestore.collection("sessions");
    const before = (await firebase.doc(id).get()).data();
    if (before === undefined) throw new Error("session document missing");
    expect(before["client"]).toBe("console");
    expect(before["amr"]).toEqual([EMAIL_LINK_AMR]);
    expect(before["stepUpAt"]).toBeNull();
    expect(before).not.toHaveProperty("lastSeenAt");
    const createdAt = (before["createdAt"] as Timestamp).toMillis();
    expect((before["authTime"] as Timestamp).toMillis()).toBe(createdAt);
    expect((before["expiresAt"] as Timestamp).toMillis() - createdAt).toBe(604_800_000);

    const sessions = testApp.app.get(SessionService);
    await sessions.validate(id);
    const csrf = await server.inject({
      method: "GET",
      url: "/v1/sessions/csrf",
      headers: { cookie: `__session=${encodeURIComponent(signedCookie(consoleRes))}` },
    });
    expect(csrf.statusCode).toBe(200);
    expect(Object.keys(csrf.json() as object).sort()).toEqual(["csrfToken"]);
    await sessions.setSomnusUserId(id, "018f0000-0000-7000-8000-0000000000aa");

    const after = (await firebase.doc(id).get()).data();
    if (after === undefined) throw new Error("session document missing");
    expect(after["client"]).toBe(before["client"]);
    expect(after["amr"]).toEqual(before["amr"]);
    expect(after["authTime"]).toEqual(before["authTime"]);
    expect(after["stepUpAt"]).toBeNull();
    expect(after["expiresAt"]).toEqual(before["expiresAt"]);
    expect(after).not.toHaveProperty("lastSeenAt");
    expect(after["somnusUserId"]).toBe("018f0000-0000-7000-8000-0000000000aa");
  });
});
