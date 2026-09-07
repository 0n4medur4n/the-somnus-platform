import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The admin console's Hosting guard, proven on a real build rather than a
 * synthetic one.
 *
 * `hosting-bundle.test.ts` proves the guard script's rules against hand-built
 * fixtures. This proves the rules are actually *in front of the admin console's
 * deploy* -- which they were not: `apps/somnus-admin` shipped with a plain
 * `vite build`, so its bundle carried `localhost:8080` and `demo-api-key`, and
 * nothing failed. A correct guard nobody points at protects nothing.
 *
 * So this builds the console the way the deploy builds it, runs the real guard
 * over the real output, and then plants each marker into a copy to confirm the
 * guard would have stopped it.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ADMIN = join(REPO_ROOT, "apps/somnus-admin");
const DIST = join(ADMIN, "dist");
const VITE = join(ADMIN, "node_modules/vite/bin/vite.js");

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories.splice(0)) {
    // Same guard the sibling suite uses: never hand rmSync a path that is not
    // demonstrably one of ours.
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}somnus-admin-dist-`)) {
      throw new Error("Unsafe temporary test directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Builds the console exactly as ci.yml's deploy-hosting job does. */
function build(environment = "dev", env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [VITE, "build", "--mode", `hosting-${environment}`], {
    cwd: ADMIN,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

/** Runs the deploy guard the way firebase.json's predeploy runs it. */
function check(directory: string) {
  return spawnSync(process.execPath, ["scripts/check-hosting-bundle.mjs", directory], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

/** A throwaway copy of the real build, so planting a marker never touches dist. */
function copyOfBuild(): string {
  const directory = mkdtempSync(join(tmpdir(), "somnus-admin-dist-"));
  directories.push(directory);
  cpSync(DIST, directory, { recursive: true });
  return directory;
}

function firstJavaScriptAsset(directory: string): string {
  const assets = join(directory, "assets");
  const file = readdirSync(assets).find((name) => name.endsWith(".js"));
  if (!file) throw new Error("the built bundle has no JavaScript asset");
  return join(assets, file);
}

beforeAll(() => {
  const result = build();
  if (result.status !== 0) {
    throw new Error(`hosting build failed: ${result.stderr}`);
  }
}, 300_000);

describe("the corrected build", () => {
  it("passes the deploy guard", () => {
    // The positive case. Before the fix this bundle could not have passed: it
    // had no hosting-config.json at all, and its JavaScript said localhost.
    const result = check(DIST);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("carries the real edge API and Firebase project, not the local defaults", () => {
    const config = JSON.parse(readFileSync(join(DIST, "hosting-config.json"), "utf8")) as Record<
      string,
      string
    >;

    expect(config["environment"]).toBe("dev");
    expect(config["VITE_EDGE_API_URL"]).toMatch(/^https:\/\//);
    expect(config["VITE_FIREBASE_API_KEY"]).toMatch(/^AIza/);
    expect(config["VITE_FIREBASE_PROJECT_ID"]).toBe("the-somnuss");
    expect(config["VITE_FIREBASE_AUTH_DOMAIN"]).toBe("the-somnuss.firebaseapp.com");
  });

  it("ships no source maps", () => {
    const maps = readdirSync(join(DIST, "assets")).filter((name) => name.endsWith(".map"));

    expect(maps).toEqual([]);
  });
});

describe("a planted local marker fails the deploy", () => {
  it.each([
    "http://localhost:8080",
    "demo-api-key",
    "somnus-dev-test",
    "http://127.0.0.1:9099",
    "somnus-dev-test.firebaseapp.com",
    "FIREBASE_AUTH_EMULATOR_HOST",
  ])("%s in the JavaScript stops it", (marker) => {
    const directory = copyOfBuild();
    appendFileSync(firstJavaScriptAsset(directory), `;const planted=${JSON.stringify(marker)};`);

    const result = check(directory);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local/emulator marker");
  });

  it("a marker in index.html stops it too, not just in the assets", () => {
    const directory = copyOfBuild();
    appendFileSync(join(directory, "index.html"), "<!-- demo-api-key -->");

    expect(check(directory).status).toBe(1);
  });

  it("output from a plain `vite build` cannot be deployed at all", () => {
    // A plain build emits no hosting-config.json, which is the file the guard
    // reads first. This is what the console was deployed from.
    const directory = copyOfBuild();
    rmSync(join(directory, "hosting-config.json"));

    expect(check(directory).status).toBe(1);
  });
});

describe("the strict schema refuses a local configuration before anything is bundled", () => {
  it.each([
    ["VITE_EDGE_API_URL", "http://localhost:8080"],
    ["VITE_FIREBASE_API_KEY", "demo-api-key"],
    ["VITE_AUTH_EMULATOR_URL", "http://127.0.0.1:9099"],
  ])("refuses to build when %s is %s", (key, value) => {
    // Cheaper and earlier than the bundle scan: the build throws while resolving
    // its config, so a misconfigured deploy never reaches the point of producing
    // an artifact someone might publish by hand.
    const result = build("dev", { [key]: value });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Invalid Hosting configuration");
  });

  it("refuses an unknown Hosting environment", () => {
    const result = build("laptop");

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown Hosting environment");
  });
}, 300_000);

describe("the guard is wired to the admin console's deploys, not just available", () => {
  it("firebase.json runs it as a predeploy on the admin target", () => {
    const config = JSON.parse(readFileSync(join(REPO_ROOT, "firebase.json"), "utf8")) as {
      hosting: { target: string; predeploy?: string[] }[];
    };

    expect(config.hosting.find((target) => target.target === "admin")?.predeploy).toContain(
      "node scripts/check-hosting-bundle.mjs apps/somnus-admin/dist",
    );
  });

  it("ci.yml's Hosting deploy builds the console in hosting mode", () => {
    // The defect in one line: this job used to run `@somnus/admin build`.
    const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("  deploy-hosting:"));

    expect(job).toContain("@somnus/admin build:hosting --mode hosting-dev");
    expect(job).not.toMatch(/@somnus\/admin build\s*$/m);
  });

  it("the promotion pipeline builds it in that environment's hosting mode", () => {
    const promotion = readFileSync(
      join(REPO_ROOT, ".github/workflows/deploy-environment.yml"),
      "utf8",
    );

    expect(promotion).toContain(
      `@somnus/admin build:hosting --mode "hosting-\${HOSTING_ENVIRONMENT}"`,
    );
  });
});
