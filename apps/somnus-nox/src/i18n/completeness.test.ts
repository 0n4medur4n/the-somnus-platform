import { describe, expect, it } from "vitest";
import { resources } from "./index.js";

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const reference = flatten(resources.es.translation).sort();

describe("i18n completeness", () => {
  it("the reference locale (es) is non-empty", () => {
    expect(reference.length).toBeGreaterThan(0);
  });

  for (const lng of ["en", "ca", "fr"] as const) {
    it(`${lng} has exactly the same keys as es`, () => {
      expect(flatten(resources[lng].translation).sort()).toEqual(reference);
    });
  }
});
