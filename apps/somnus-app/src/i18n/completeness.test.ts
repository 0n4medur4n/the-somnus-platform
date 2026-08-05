import { describe, expect, it } from "vitest";
import { resources } from "./index.js";

/** Flattens a nested locale object into sorted dotted key paths. */
function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

const reference = flatten(resources.es.translation).sort();

describe("i18n completeness (build plan §3.3: a missing key fails CI)", () => {
  it("the reference locale (es) is non-empty", () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  for (const lng of ["en", "ca", "fr"] as const) {
    it(`${lng} has exactly the same keys as es (no missing, no extra)`, () => {
      const keys = flatten(resources[lng].translation).sort();
      expect(keys).toEqual(reference);
    });
  }
});
