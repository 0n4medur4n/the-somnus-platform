import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpMorpheoMaintenanceClient } from "../src/modules/maintenance/morpheo-maintenance.client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpMorpheoMaintenanceClient", () => {
  it("POSTs the cutoff to morpheo and returns the parsed count", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deleted: 4 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new HttpMorpheoMaintenanceClient(
      "http://morpheo:8080/",
    ).deleteUnclaimedAssessments("2026-07-21T12:00:00.000Z");

    expect(result.deleted).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://morpheo:8080/internal/v1/maintenance/unclaimed-assessments/delete");
    expect(String(init.body)).toContain("2026-07-21T12:00:00.000Z");
  });

  it("hits the claim-tokens path for the token cleanup", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ deleted: 0 }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await new HttpMorpheoMaintenanceClient("http://morpheo:8080").deleteExpiredClaimTokens("x");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/claim-tokens/delete");
  });

  it("throws on a non-2xx morpheo response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    await expect(
      new HttpMorpheoMaintenanceClient("http://m").deleteUnclaimedAssessments("x"),
    ).rejects.toThrow("500");
  });

  it("rejects a response that does not match the contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ deleted: -1 }) })),
    );
    await expect(
      new HttpMorpheoMaintenanceClient("http://m").deleteUnclaimedAssessments("x"),
    ).rejects.toThrow();
  });
});
