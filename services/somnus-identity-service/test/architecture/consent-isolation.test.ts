import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cruise } from "dependency-cruiser";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Build plan §20 Checkpoint 7.1 / ADR 0010: "identity code reaches
 * consent only through the module's public interface." This is the
 * architectural test the checkpoint asks for, backed by
 * dependency-cruiser's real import-graph analysis (not a regex scan)
 * -- see `.dependency-cruiser.cjs` for the rule and why it's a
 * whitelist by construction.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = join(__dirname, "..", "..");

const RULE_SET = {
  forbidden: [
    {
      name: "consent-isolation",
      severity: "error" as const,
      from: { pathNot: "^src/modules/consent/" },
      to: {
        path: "^src/modules/consent/",
        pathNot: "^src/modules/consent/(consent\\.service\\.ts|consent\\.module\\.ts)$",
      },
    },
  ],
};

async function cruiseSrc(): Promise<{ violations: unknown[] }> {
  const result = await cruise([join(SERVICE_ROOT, "src")], {
    outputType: "json",
    // Without this, dependency-cruiser builds the import graph but
    // never actually runs the rules against it -- every violation
    // count comes back 0 regardless of the ruleSet, silently. Do not
    // remove this: the whole point of this test is catching that.
    validate: true,
    ruleSet: RULE_SET,
  });
  const parsed = JSON.parse(result.output as string) as { summary: { violations: unknown[] } };
  return { violations: parsed.summary.violations };
}

// A full TS-aware source-tree scan is inherently heavier than a typical
// test, and slower still under v8 coverage instrumentation -- the
// default 20s testTimeout (test/vitest.config.ts) isn't enough headroom.
const CRUISE_TEST_TIMEOUT_MS = 60_000;

describe("consent module isolation (IMMUTABLE-adjacent -- build plan §20 Checkpoint 7.1)", () => {
  it(
    "no file outside src/modules/consent/ imports anything but consent.service.ts / consent.module.ts",
    async () => {
      const { violations } = await cruiseSrc();
      expect(violations).toEqual([]);
    },
    CRUISE_TEST_TIMEOUT_MS,
  );

  describe("meta-test: the rule is not accidentally a no-op", () => {
    const fixturePath = join(SERVICE_ROOT, "src", "modules", "__consent_isolation_fixture.ts");

    afterEach(async () => {
      await rm(fixturePath, { force: true });
    });

    it(
      "flags a deliberate import of a consent-internal file from outside the module",
      async () => {
        await writeFile(
          fixturePath,
          'import { ConsentReceiptsRepository } from "./consent/db/repositories/consent-receipts.repository.js";\nexport const x = ConsentReceiptsRepository;\n',
          "utf8",
        );

        const { violations } = await cruiseSrc();

        expect(violations.length).toBeGreaterThan(0);
        expect(violations).toContainEqual(
          expect.objectContaining({
            rule: expect.objectContaining({ name: "consent-isolation" }),
          }),
        );
      },
      CRUISE_TEST_TIMEOUT_MS,
    );
  });
});
