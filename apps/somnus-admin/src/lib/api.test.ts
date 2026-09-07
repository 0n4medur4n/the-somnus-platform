import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "./api.js";

type FetchInit = { headers: Record<string, string>; credentials?: string; body?: string };

function mockFetch(status: number, body?: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function initOf(fn: ReturnType<typeof vi.fn>): FetchInit {
  return fn.mock.calls[0]?.[1] as FetchInit;
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "somnus_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("GET parses JSON, sends a correlation id, and includes credentials", async () => {
    const fetchMock = mockFetch(200, { ok: true });
    const data = await api.get<{ ok: boolean }>("/v1/me");
    expect(data).toEqual({ ok: true });
    const init = initOf(fetchMock);
    expect(init.headers["x-correlation-id"]).toBeTruthy();
    expect(init.credentials).toBe("include");
  });

  it("POST echoes the readable CSRF cookie in x-csrf-token", async () => {
    document.cookie = "somnus_csrf=csrf-abc";
    const fetchMock = mockFetch(200, {});
    await api.post("/v1/registration", { firstName: "A" });
    const init = initOf(fetchMock);
    expect(init.headers["x-csrf-token"]).toBe("csrf-abc");
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("omits x-csrf-token when there is no cookie (login bootstrap)", async () => {
    const fetchMock = mockFetch(201, { firebaseUid: "u" });
    await api.post("/v1/sessions", { idToken: "x" });
    expect(initOf(fetchMock).headers["x-csrf-token"]).toBeUndefined();
  });

  it("returns undefined on 204", async () => {
    mockFetch(204);
    expect(await api.del("/v1/sessions/current")).toBeUndefined();
  });

  it("throws ApiRequestError carrying the §16 stable code on failure", async () => {
    mockFetch(404, { error: { code: "NOT_FOUND", message: "gone" } });
    await expect(api.get("/v1/me")).rejects.toBeInstanceOf(ApiRequestError);
    mockFetch(404, { error: { code: "NOT_FOUND", message: "gone" } });
    await expect(api.get("/v1/me")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
