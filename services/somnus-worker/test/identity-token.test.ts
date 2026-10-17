import { afterEach, describe, expect, it, vi } from "vitest";
import { identityHeaders, onCloudRun } from "../src/common/identity-token.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identityHeaders", () => {
  it("attaches nothing off Cloud Run (local Morpheo is not behind IAM)", async () => {
    const fetchToken = vi.fn(async () => "never");
    expect(await identityHeaders({ fetch: fetchToken, enabled: false })("https://m")).toEqual({});
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it("asks for a token for the audience and reuses it until it is about to expire", async () => {
    let clock = 0;
    const fetchToken = vi.fn(async (audience: string) => `token-for-${audience}-${clock}`);
    const headers = identityHeaders({ fetch: fetchToken, enabled: true, now: () => clock });

    expect(await headers("https://m")).toEqual({ authorization: "Bearer token-for-https://m-0" });
    clock = 54 * 60 * 1000;
    expect(await headers("https://m")).toEqual({ authorization: "Bearer token-for-https://m-0" });
    clock = 56 * 60 * 1000;
    expect(await headers("https://m")).toEqual({
      authorization: `Bearer token-for-https://m-${56 * 60 * 1000}`,
    });
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("reads the token from the metadata server, with the Metadata-Flavor header", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => "abc\n" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await identityHeaders({ enabled: true })("https://morpheo.run.app")).toEqual({
      authorization: "Bearer abc",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/instance/service-accounts/default/identity?audience=");
    expect(url).toContain(encodeURIComponent("https://morpheo.run.app"));
    expect((init.headers as Record<string, string>)["Metadata-Flavor"]).toBe("Google");
  });

  it("fails loudly when the metadata server refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, text: async () => "" })),
    );
    await expect(identityHeaders({ enabled: true })("https://m")).rejects.toThrow("403");
  });

  it("detects Cloud Run from K_SERVICE or CLOUD_RUN_JOB", () => {
    expect(onCloudRun({ K_SERVICE: "somnus-worker" })).toBe(true);
    expect(onCloudRun({ CLOUD_RUN_JOB: "j" })).toBe(true);
    expect(onCloudRun({})).toBe(false);
  });
});
