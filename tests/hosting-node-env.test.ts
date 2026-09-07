import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A Hosting build must not depend on the ambient NODE_ENV.
 *
 * Both SPAs keep their local defaults (`localhost:8080`, `demo-api-key`) behind
 * `import.meta.env.DEV`, so a production build drops the branch. Vite derives
 * DEV from NODE_ENV -- so an inherited `NODE_ENV=test`, which any test runner
 * sets, leaves the branch in and puts localhost back into a deployable bundle.
 *
 * That is not hypothetical: it is how this was found. The admin console's first
 * hosting build, run from inside vitest, failed its own guard on exactly this.
 * The consumer SPA had the same defect; its guard would have turned it into a
 * failed deploy rather than a bad one, but "the deploy breaks whenever someone
 * exports NODE_ENV" is not a property worth keeping either.
 *
 * Both configs now pin DEV/PROD themselves. This proves it stays that way.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
/**
 * The three values `src/config/env.ts` falls back to locally. Deliberately NOT a
 * bare `localhost`: React Router bundles a dummy `http://localhost` origin to
 * resolve relative URLs, which `check-hosting-bundle.mjs` whitelists by exact
 * expression. Matching that too would make this test stricter than the guard it
 * is backing up, and fail on a perfectly good bundle.
 */
const LOCAL_CONFIG = /localhost:8080|demo-api-key|somnus-dev-test/;

describe("both Hosting builds pin their own production flags", () => {
  it.each(["somnus-app", "somnus-admin"])(
    "%s does not leave DEV to the environment",
    (application) => {
      const config = readFileSync(join(REPO_ROOT, "apps", application, "vite.config.ts"), "utf8");

      expect(config).toContain('"import.meta.env.DEV": "false"');
      expect(config).toContain('"import.meta.env.PROD": "true"');
    },
  );
});

describe("the consumer SPA builds clean under a hostile NODE_ENV", () => {
  it("produces no local markers when NODE_ENV=test is inherited", () => {
    // The admin console gets this for free: its own suite builds it from inside
    // vitest, so every run of that file is this same check. The SPA has no such
    // build in its test path, so it is done explicitly here.
    const application = join(REPO_ROOT, "apps/somnus-app");
    const result = spawnSync(
      process.execPath,
      [join(application, "node_modules/vite/bin/vite.js"), "build", "--mode", "hosting-dev"],
      {
        cwd: application,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "test" },
      },
    );

    // The build's own closeBundle guard scans the output, so a non-zero exit
    // here IS the regression -- but assert the bundle too, in case the guard is
    // ever what breaks.
    expect(`${result.stdout}${result.stderr}`).not.toContain("local/emulator marker");
    expect(result.status).toBe(0);

    const assets = join(application, "dist/assets");
    for (const file of readdirSync(assets)) {
      expect(readFileSync(join(assets, file), "utf8")).not.toMatch(LOCAL_CONFIG);
    }
  }, 300_000);
});
