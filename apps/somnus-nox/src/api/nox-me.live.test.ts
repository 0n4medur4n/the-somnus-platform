import { afterEach, describe, expect, it, vi } from "vitest";
import { devPreview, fetchNoxMe } from "./nox-me.live.js";

describe("live GET /nox/v1/me", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, "", "/");
  });

  it("ignores the dev preview query", () => {
    window.history.pushState({}, "", "/?preview=dashboard");
    expect(devPreview()).toBeNull();
  });

  it("sends only GET /nox/v1/me and returns the JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ verifiedProfessional: true, noxAccess: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;

    await expect(fetchNoxMe(signal)).resolves.toEqual({
      verifiedProfessional: true,
      noxAccess: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/nox/v1/me");
    expect(init.method).toBe("GET");
    expect(init.signal).toBe(signal);
    expect(init.credentials).toBe("same-origin");
    expect(init.body).toBeUndefined();
  });

  it("rejects any non-OK response without reading a body", async () => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json }));
    await expect(fetchNoxMe(new AbortController().signal)).rejects.toThrow("nox-me-rejected");
    expect(json).not.toHaveBeenCalled();
  });
});
