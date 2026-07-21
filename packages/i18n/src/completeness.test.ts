import { describe, expect, it } from "vitest";
import { checkCompleteness, formatCompletenessReport } from "./completeness.js";
import type { LocaleBundle } from "./loader.js";

function bundle(locale: "es" | "en" | "ca" | "fr", dict: Record<string, string>): LocaleBundle {
  return { locale, dictionary: Object.freeze(dict), source: `memory://${locale}` };
}

describe("checkCompleteness", () => {
  it("returns ok when all 4 locales have identical key sets", () => {
    const dict = { "auth.login.title": "Login", "auth.error.unauthenticated": "Please sign in" };
    const r = checkCompleteness([
      bundle("es", dict),
      bundle("en", dict),
      bundle("ca", dict),
      bundle("fr", dict),
    ]);
    expect(r.ok).toBe(true);
    for (const loc of ["es", "en", "ca", "fr"] as const) {
      expect(r.missing[loc]).toEqual([]);
      expect(r.extra[loc]).toEqual([]);
    }
  });

  it("fails when a locale is missing a key (the test that proves completeness is enforced)", () => {
    const r = checkCompleteness([
      bundle("es", { a: "a-es", b: "b-es", c: "c-es" }),
      bundle("en", { a: "a-en", c: "c-en" }),
      bundle("ca", { a: "a-ca", b: "b-ca", c: "c-ca" }),
      bundle("fr", { a: "a-fr", b: "b-fr", c: "c-fr" }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.missing["en"]).toEqual(["b"]);
    expect(r.missing["es"]).toEqual([]);
    expect(r.extra["en"]).toEqual([]);
  });

  it("fails when a locale has an extra key not in the reference", () => {
    const r = checkCompleteness([
      bundle("es", { a: "x" }),
      bundle("en", { a: "x", extra: "x" }),
      bundle("ca", { a: "x" }),
      bundle("fr", { a: "x" }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.extra["en"]).toEqual(["extra"]);
  });

  it("fails when a locale is entirely missing", () => {
    const r = checkCompleteness([
      bundle("es", { a: "x", b: "y" }),
      bundle("en", { a: "x", b: "y" }),
      bundle("fr", { a: "x", b: "y" }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.missing["ca"]).toEqual(["a", "b"]);
  });

  it("rejects when the reference locale itself is missing from the bundles", () => {
    expect(() =>
      checkCompleteness([
        bundle("en", { a: "x" }),
        bundle("ca", { a: "x" }),
        bundle("fr", { a: "x" }),
      ]),
    ).toThrow(/reference locale "es"/);
  });

  it("formatCompletenessReport says OK when all locales match", () => {
    const r = checkCompleteness([
      bundle("es", { a: "x" }),
      bundle("en", { a: "x" }),
      bundle("ca", { a: "x" }),
      bundle("fr", { a: "x" }),
    ]);
    expect(formatCompletenessReport(r)).toMatch(/OK/);
  });

  it("formatCompletenessReport lists every missing key per locale", () => {
    const r = checkCompleteness([
      bundle("es", { a: "x", b: "y" }),
      bundle("en", { a: "x" }),
      bundle("ca", { a: "x", b: "y" }),
      bundle("fr", { a: "x", b: "y" }),
    ]);
    const report = formatCompletenessReport(r);
    expect(report).toMatch(/FAIL/);
    expect(report).toMatch(/en: missing 1 key\(s\): b/);
  });
});
