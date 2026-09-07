import { describe, expect, it } from "vitest";
import { ADMIN_LOCALES, resources } from "./index.js";

/** Flattens a nested locale object into sorted dotted key paths. */
function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

const reference = flatten(resources.es.translation).sort();

/**
 * Build plan §3.3: a missing key fails CI. The console ships in es and en only
 * (Addendum A §A5.5) -- a narrower locale set than the consumer app, but the
 * same completeness rule.
 */
describe("admin console i18n completeness", () => {
  it("ships exactly the two internal locales", () => {
    expect([...ADMIN_LOCALES]).toEqual(["es", "en"]);
  });

  it("the reference locale (es) is non-empty", () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  it("en has exactly the same keys as es (no missing, no extra)", () => {
    expect(flatten(resources.en.translation).sort()).toEqual(reference);
  });
});
