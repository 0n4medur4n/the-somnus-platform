import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The transport, and in particular how the CSRF token reaches state-changing
 * requests.
 *
 * Until 2026-10-05 the token was read from a `somnus_csrf` cookie. In every
 * deployed environment that cookie belongs to edge-api's site, which this page
 * cannot read, so no token was ever sent and every authenticated mutation got a
 * 403. These tests pin the replacement: the token comes from response bodies
 * and is held in memory -- and a cookie, even one with that exact name, is
 * never consulted.
 *
 * Each test imports a fresh copy of the module, because the token is module
 * state and a fresh page load starts without one.
 */

type Init = {
  method?: string;
  headers: Record<string, string>;
  credentials?: string;
  body?: string;
};
type Reply = { status: number; body?: unknown };
type Call = { method: string; path: string; init: Init };

const BASE = "http://edge.test";

async function loadApi() {
  vi.resetModules();
  vi.doMock("../config/env.js", () => ({ env: { VITE_EDGE_API_URL: BASE } }));
  return import("./api.js");
}

/**
 * A fetch that answers by `METHOD path`. A value that is an array is consumed
 * one reply per call, so a test can script "403 first, then 201".
 */
function routeFetch(routes: Record<string, Reply | Reply[]>): Call[] {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: Init) => {
    const method = init.method ?? "GET";
    const path = url.slice(BASE.length);
    calls.push({ method, path, init });
    const route = routes[`${method} ${path}`];
    const reply = Array.isArray(route) ? route.shift() : route;
    if (!reply) throw new Error(`unexpected request: ${method} ${path}`);
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: async () => (reply.body === undefined ? "" : JSON.stringify(reply.body)),
    };
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const SESSION = { firebaseUid: "u", email: null, expiresAt: "2030-01-01T00:00:00.000Z" };
const csrfForbidden = {
  status: 403,
  body: {
    error: { code: "FORBIDDEN", message: "x", correlationId: "c", details: { reason: "csrf" } },
  },
};

describe("api client", () => {
  beforeEach(() => {
    // A cookie with the old name is present in every test, to prove it is
    // never read: this is the exact mechanism that failed in production.
    // biome-ignore lint/suspicious/noDocumentCookie: planting the cookie the client must ignore is the test
    document.cookie = "somnus_csrf=from-a-cookie";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../config/env.js");
    // biome-ignore lint/suspicious/noDocumentCookie: removing the cookie planted above
    document.cookie = "somnus_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("GET parses JSON, sends a correlation id, includes credentials, and no CSRF header", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({ "GET /v1/me": { status: 200, body: { ok: true } } });
    expect(await api.get<{ ok: boolean }>("/v1/me")).toEqual({ ok: true });
    expect(calls[0]?.init.headers["x-correlation-id"]).toBeTruthy();
    expect(calls[0]?.init.credentials).toBe("include");
    expect(calls[0]?.init.headers["x-csrf-token"]).toBeUndefined();
  });

  it("sends no CSRF header to POST /v1/sessions, and keeps the token it returns", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "POST /v1/sessions": { status: 201, body: { ...SESSION, csrfToken: "tok-login" } },
      "POST /v1/registration": { status: 201, body: {} },
    });

    await api.post("/v1/sessions", { idToken: "x" });
    await api.post("/v1/registration", { firstName: "A" });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/sessions",
      "POST /v1/registration",
    ]);
    expect(calls[0]?.init.headers["x-csrf-token"]).toBeUndefined();
    expect(calls[1]?.init.headers["x-csrf-token"]).toBe("tok-login");
    expect(calls[1]?.init.headers["content-type"]).toBe("application/json");
  });

  it("never reads the token from a cookie, even one named somnus_csrf", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "GET /v1/sessions/csrf": { status: 200, body: { csrfToken: "tok-fetched" } },
      "POST /v1/registration": { status: 201, body: {} },
    });

    await api.post("/v1/registration", { firstName: "A" });

    const sent = calls.find((c) => c.path === "/v1/registration");
    expect(sent?.init.headers["x-csrf-token"]).toBe("tok-fetched");
    expect(calls.some((c) => c.init.headers["x-csrf-token"] === "from-a-cookie")).toBe(false);
  });

  it("fetches a token once when it has none (after a reload), then reuses it", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "GET /v1/sessions/csrf": { status: 200, body: { csrfToken: "tok-reload" } },
      "PATCH /v1/me/profile": [
        { status: 200, body: {} },
        { status: 200, body: {} },
      ],
    });

    await api.patch("/v1/me/profile", { firstName: "A" });
    await api.patch("/v1/me/profile", { firstName: "B" });

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/sessions/csrf",
      "PATCH /v1/me/profile",
      "PATCH /v1/me/profile",
    ]);
    expect(calls[1]?.init.headers["x-csrf-token"]).toBe("tok-reload");
    expect(calls[2]?.init.headers["x-csrf-token"]).toBe("tok-reload");
  });

  it("on a CSRF rejection refreshes the token and retries exactly once", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "POST /v1/sessions": { status: 201, body: { ...SESSION, csrfToken: "tok-stale" } },
      "POST /v1/registration": [csrfForbidden, { status: 201, body: { id: "r1" } }],
      "GET /v1/sessions/csrf": { status: 200, body: { csrfToken: "tok-fresh" } },
    });

    await api.post("/v1/sessions", { idToken: "x" });
    expect(await api.post("/v1/registration", {})).toEqual({ id: "r1" });

    const attempts = calls.filter((c) => c.path === "/v1/registration");
    expect(attempts.map((c) => c.init.headers["x-csrf-token"])).toEqual(["tok-stale", "tok-fresh"]);
  });

  it("does not retry a second CSRF rejection", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "GET /v1/sessions/csrf": [
        { status: 200, body: { csrfToken: "t1" } },
        { status: 200, body: { csrfToken: "t2" } },
      ],
      "POST /v1/registration": [csrfForbidden, csrfForbidden],
    });

    await expect(api.post("/v1/registration", {})).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(calls.filter((c) => c.path === "/v1/registration")).toHaveLength(2);
  });

  it("never retries a 403 that means 'not allowed'", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "POST /v1/sessions": { status: 201, body: { ...SESSION, csrfToken: "tok" } },
      "POST /v1/organizations": {
        status: 403,
        body: { error: { code: "FORBIDDEN", message: "x", correlationId: "c", details: {} } },
      },
    });

    await api.post("/v1/sessions", { idToken: "x" });
    await expect(api.post("/v1/organizations", {})).rejects.toMatchObject({ status: 403 });
    expect(calls.filter((c) => c.path === "/v1/organizations")).toHaveLength(1);
    expect(calls.some((c) => c.path === "/v1/sessions/csrf")).toBe(false);
  });

  it("surfaces a 401 when there is no session to get a token for", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "GET /v1/sessions/csrf": {
        status: 401,
        body: { error: { code: "UNAUTHENTICATED", message: "x", correlationId: "c", details: {} } },
      },
    });

    await expect(api.post("/v1/registration", {})).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    // The mutation itself is never sent without a token.
    expect(calls.some((c) => c.path === "/v1/registration")).toBe(false);
  });

  it("forgets the token on logout, so the next session fetches its own", async () => {
    const { api } = await loadApi();
    const calls = routeFetch({
      "POST /v1/sessions": { status: 201, body: { ...SESSION, csrfToken: "tok-old" } },
      "DELETE /v1/sessions/current": { status: 204 },
      "GET /v1/sessions/csrf": { status: 200, body: { csrfToken: "tok-new" } },
      "POST /v1/registration": { status: 201, body: {} },
    });

    await api.post("/v1/sessions", { idToken: "x" });
    expect(await api.del("/v1/sessions/current")).toBeUndefined();
    await api.post("/v1/registration", {});

    const logout = calls.find((c) => c.method === "DELETE");
    expect(logout?.init.headers["x-csrf-token"]).toBe("tok-old");
    const after = calls.find((c) => c.path === "/v1/registration");
    expect(after?.init.headers["x-csrf-token"]).toBe("tok-new");
  });

  it("throws ApiRequestError carrying the §16 stable code on failure", async () => {
    const { api, ApiRequestError } = await loadApi();
    routeFetch({
      "GET /v1/me": [
        { status: 404, body: { error: { code: "NOT_FOUND", message: "gone" } } },
        { status: 404, body: { error: { code: "NOT_FOUND", message: "gone" } } },
      ],
    });
    await expect(api.get("/v1/me")).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.get("/v1/me")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
