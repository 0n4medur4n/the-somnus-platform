import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The E2E harness raises its own rate limit. Production must never be the thing
 * that moves instead.
 *
 * edge-api's limiter (build plan §21) is global and keyed by client IP -- not
 * scoped to a route, and not exempting `/health/live`. The whole E2E suite
 * arrives from 127.0.0.1, so nineteen sequential tests share one budget of 100
 * requests per minute and the later ones take 429s on `POST /v1/sessions` that
 * have nothing to do with what they are testing. That is the limiter working
 * exactly as designed; the harness is what was misconfigured.
 *
 * The tempting "fix" is to raise the default so the tests stop failing, which
 * would quietly weaken every deployed environment to make a test suite green.
 * These assertions exist to make that impossible to do by accident: the default
 * is pinned, the harness value must differ from it, and both are read from the
 * files that actually decide them rather than restated here.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const EDGE_CONFIG = readFileSync(
  join(REPO_ROOT, "services", "somnus-edge-api", "src", "config", "edge-config.ts"),
  "utf8",
);
const E2E_STACK = readFileSync(join(REPO_ROOT, "scripts", "e2e-stack.mjs"), "utf8");

/**
 * Reads a number out of its source rather than trusting a copy kept here.
 *
 * Every caller asserts the match is non-null first: a pattern that silently
 * stops matching would turn this whole file into a test that passes because it
 * checks nothing, which is the failure mode it is meant to prevent.
 */
function matched(source: string, pattern: RegExp): number | null {
  const found = pattern.exec(source);
  // `60_000` is how the schema writes it; the separator is a literal, not part
  // of the number.
  return found?.[1] === undefined ? null : Number(found[1].replaceAll("_", ""));
}

const productionMax = matched(EDGE_CONFIG, /RATE_LIMIT_MAX:[\s\S]{0,120}?\.default\((\d+)\)/);
const productionWindow = matched(
  EDGE_CONFIG,
  /RATE_LIMIT_WINDOW_MS:[\s\S]{0,120}?\.default\((\d[\d_]*)\)/,
);
const e2eMax = matched(E2E_STACK, /const E2E_RATE_LIMIT_MAX = "(\d+)"/);

describe("the E2E rate limit diverges from the deployed one (build plan §21)", () => {
  it("still finds both values in their own source files", () => {
    // If a rename lands, this is the assertion that says so -- rather than the
    // divergence checks below quietly comparing null to null.
    expect(productionMax, "RATE_LIMIT_MAX default not found in edge-config.ts").not.toBeNull();
    expect(
      productionWindow,
      "RATE_LIMIT_WINDOW_MS default not found in edge-config.ts",
    ).not.toBeNull();
    expect(e2eMax, "E2E_RATE_LIMIT_MAX not found in scripts/e2e-stack.mjs").not.toBeNull();
  });

  it("keeps the deployed default where Phase 8 put it", () => {
    // Nothing in terraform, the deploy workflows or docker-compose sets these,
    // so the schema default IS the production limit. Moving it is a deliberate
    // decision about the platform's exposure, and it should require editing a
    // test that says so out loud -- not just a config line.
    expect(productionMax).toBe(100);
    expect(productionWindow).toBe(60_000);
  });

  it("gives the harness a different, more permissive ceiling", () => {
    expect(e2eMax).not.toBe(productionMax);
    // More permissive, not merely different: a typo that tightened the harness
    // would reproduce the original failure while passing an inequality check.
    expect(e2eMax as number).toBeGreaterThan(productionMax as number);
  });

  it("applies the override to edge-api and nowhere else", () => {
    // The constant has to actually reach the service, and it has to reach only
    // the service under test in the harness.
    expect(E2E_STACK).toMatch(/RATE_LIMIT_MAX: E2E_RATE_LIMIT_MAX/);
    expect(E2E_STACK.match(/RATE_LIMIT_MAX: E2E_RATE_LIMIT_MAX/g)).toHaveLength(1);
    // The window is deliberately left alone, so the two configurations differ
    // on exactly one axis.
    expect(E2E_STACK).not.toMatch(/RATE_LIMIT_WINDOW_MS:/);
  });
});
