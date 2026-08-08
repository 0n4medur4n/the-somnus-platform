import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCompleteness, formatCompletenessReport, loadLocaleBundles } from "@somnus/i18n";

/**
 * Marketing i18n completeness gate — build plan §3.3 / ADR 0012.
 *
 * A missing key (or an extra key) in any of the four locales must fail CI.
 * This test reuses the shared `@somnus/i18n` infrastructure so the rule is
 * enforced exactly the same way across the SPA, marketing site, emails
 * and reports.
 */
const here = dirname(fileURLToPath(import.meta.url));

describe("marketing i18n completeness (es/en/ca/fr)", () => {
  it("all four locales share exactly the same key set", () => {
    const bundles = loadLocaleBundles({ baseDir: here });
    const result = checkCompleteness(bundles, { reference: "es" });
    if (!result.ok) {
      // Throw the human-readable report so the CI log names every key.
      throw new Error(formatCompletenessReport(result));
    }
    expect(result.ok).toBe(true);
  });

  it("rejects a missing key (immutable negative test)", () => {
    const bundles = loadLocaleBundles({ baseDir: here });
    const broken = bundles.map((b) => {
      if (b.locale !== "fr") return b;
      const dict: Record<string, string> = { ...b.dictionary };
      delete dict["footer.copyright"];
      return { ...b, dictionary: dict };
    });
    const result = checkCompleteness(broken, { reference: "es" });
    expect(result.ok).toBe(false);
    expect(result.missing.fr).toContain("footer.copyright");
  });
});
