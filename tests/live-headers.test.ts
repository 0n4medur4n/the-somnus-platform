import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareHeaders,
  expectedAssetCache,
  expectedHeaders,
  metaPolicy,
  policyProblems,
  SITES,
} from "../scripts/check-live-headers.mjs";

const config = JSON.parse(readFileSync("firebase.json", "utf8"));

function headersOf(target: string): Headers {
  return new Headers([...expectedHeaders(config, target)]);
}

describe("check-live-headers", () => {
  it("expects headers for every site from firebase.json", () => {
    for (const site of SITES) {
      const expected = expectedHeaders(config, site.target);
      expect(expected.has("content-security-policy")).toBe(true);
      expect(expected.has("x-frame-options")).toBe(true);
    }
  });

  it("uses the three custom domains", () => {
    expect(SITES.map((site) => site.origin).sort()).toEqual([
      "https://app.thesomnus.com",
      "https://console.thesomnus.com",
      "https://thesomnus.com",
    ]);
    for (const site of SITES)
      expect(site.paths).toEqual(expect.arrayContaining(["/", "/login", "/app"]));
  });

  it("passes when a response carries exactly what firebase.json sets", () => {
    for (const site of SITES) {
      const expected = expectedHeaders(config, site.target);
      expect(compareHeaders(headersOf(site.target), expected, site.origin)).toEqual([]);
    }
  });

  it("fails when a header is missing (what production did for weeks)", () => {
    const live = headersOf("app");
    live.delete("x-frame-options");
    live.delete("content-security-policy");
    const problems = compareHeaders(live, expectedHeaders(config, "app"), "app /login");
    expect(problems).toContain("app /login: missing x-frame-options");
    expect(problems).toContain("app /login: missing content-security-policy");
  });

  it("fails when a header has a different value", () => {
    const live = headersOf("admin");
    live.set("x-frame-options", "SAMEORIGIN");
    const problems = compareHeaders(live, expectedHeaders(config, "admin"), "admin /");
    expect(problems.join("\n")).toContain('x-frame-options is "SAMEORIGIN"');
  });

  it("reads the asset cache rule and the page's meta policy", () => {
    expect(expectedAssetCache(config, "app")).toBe("public, max-age=31536000, immutable");
    expect(
      metaPolicy('<meta http-equiv="content-security-policy" content="script-src \'self\'">'),
    ).toBe("script-src 'self'");
    expect(metaPolicy("<html></html>")).toBeNull();
  });

  it("flags unsafe-inline and unsafe-eval in a served policy", () => {
    expect(policyProblems("script-src 'self'", "x")).toEqual([]);
    expect(policyProblems("script-src 'unsafe-inline'", "x")).toHaveLength(1);
    expect(policyProblems("script-src 'unsafe-eval'", "x")).toHaveLength(1);
  });
});
