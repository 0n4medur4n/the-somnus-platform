import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * The `Derive CONSENT_DATABASE_URL` step, exercised rather than described.
 *
 * The identity job runs its test suite against two databases whose connection
 * strings differ by one path segment, the second derived from the first by
 * substitution. When that substitution matches nothing the two come out
 * identical, both pools open one database, and `global-setup.ts` drops the
 * identity tables it has just migrated. The job then fails ~130s later on a
 * table that no longer exists, in a suite that touched nothing related -- which
 * is exactly what happened between 2026-08-26 and 2026-09-07.
 *
 * `test/destructive-guard.ts` refuses that pair before any drop and is the
 * authoritative stop. This is the earlier layer, and this file proves it: the
 * real shell is lifted out of ci.yml and run, so what is under test is what the
 * runner executes, not a restatement of it.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

const directories: string[] = [];
afterAll(() => {
  for (const directory of directories.splice(0)) {
    if (!resolve(directory).startsWith(`${resolve(tmpdir())}${sep}somnus-derive-`)) {
      throw new Error("Unsafe temporary test directory");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

/** Lifts the step's `run:` block verbatim out of the workflow. */
function derivationScript(): string {
  const step = workflow.indexOf("      - name: Derive CONSENT_DATABASE_URL");
  if (step === -1) {
    throw new Error(
      "The `Derive CONSENT_DATABASE_URL` step is gone from ci.yml. If it was renamed or " +
        "replaced, update this test to match -- do not delete it.",
    );
  }
  const body = workflow.slice(
    workflow.indexOf("        run: |\n", step) + "        run: |\n".length,
  );
  const lines: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim().length === 0) {
      lines.push("");
      continue;
    }
    if (!line.startsWith("          ")) break;
    lines.push(line.slice(10));
  }
  return lines.join("\n");
}

const script = derivationScript();

describe("the extracted step is really the workflow's", () => {
  it("carries the substitution it exists to perform", () => {
    // Guards against a bad extraction passing everything vacuously.
    expect(script).toContain("somnus_identity");
    expect(script).toContain("somnus_consent");
    expect(script).toContain("GITHUB_ENV");
  });
});

type Result = {
  status: number;
  output: string;
  env: Map<string, string>;
};

/** Runs the real step with a given DATABASE_URL, exactly as the runner would. */
function derive(databaseUrl: string | undefined): Result {
  const directory = mkdtempSync(join(tmpdir(), "somnus-derive-"));
  directories.push(directory);
  const scriptPath = join(directory, "derive.sh");
  const envPath = join(directory, "github_env");
  writeFileSync(scriptPath, script);
  writeFileSync(envPath, "");

  const environment: NodeJS.ProcessEnv = { ...process.env, GITHUB_ENV: envPath };
  if (databaseUrl === undefined) delete environment["DATABASE_URL"];
  else environment["DATABASE_URL"] = databaseUrl;

  const run = spawnSync("bash", [scriptPath], { encoding: "utf8", env: environment });

  const env = new Map<string, string>();
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0) env.set(line.slice(0, index), line.slice(index + 1));
  }
  return { status: run.status ?? -1, output: `${run.stdout}${run.stderr}`, env };
}

const USER = "4JdTF3GpJN7acjW.root";
const PASSWORD = "not-a-real-password-value";
const HOST = "gateway01.eu-central-1.prod.aws.tidbcloud.com:4000";
const dsn = (database: string, query = "") =>
  `mysql://${USER}:${PASSWORD}@${HOST}/${database}${query}`;

describe("a DATABASE_URL that names somnus_identity", () => {
  it("passes, and derives a genuinely distinct consent target", () => {
    const result = derive(dsn("somnus_identity"));

    expect(result.status).toBe(0);
    expect(result.env.get("CONSENT_DATABASE_URL")).toBe(dsn("somnus_consent"));
    expect(result.env.get("CONSENT_DATABASE_URL")).not.toBe(dsn("somnus_identity"));
    expect(result.env.get("CONSENT_DB_SSL")).toBe("true");
  });

  it("keeps any query parameters on the derived value", () => {
    const result = derive(dsn("somnus_identity", "?ssl=true"));

    expect(result.status).toBe(0);
    expect(result.env.get("CONSENT_DATABASE_URL")).toBe(dsn("somnus_consent", "?ssl=true"));
  });

  it("writes nothing that leaks the credential into the step log", () => {
    const result = derive(dsn("somnus_identity"));

    expect(result.output).not.toContain(PASSWORD);
    expect(result.output).not.toContain(USER);
  });
});

describe("a DATABASE_URL that does not name somnus_identity", () => {
  it.each([
    ["somnus_consent", "the exact value that broke CI"],
    ["test", "a default database name"],
    ["somnus_identity_dev", "a near-miss"],
    ["SOMNUS_IDENTITY", "the right name in the wrong case"],
  ])("fails loudly for /%s (%s)", (database) => {
    const result = derive(dsn(database));

    expect(result.status).not.toBe(0);
    expect(result.env.has("CONSENT_DATABASE_URL")).toBe(false);
    expect(result.env.has("CONSENT_DB_SSL")).toBe(false);
  });

  it("names the database and host it found, so the fix is obvious", () => {
    const result = derive(dsn("somnus_consent"));

    expect(result.output).toContain("somnus_consent");
    expect(result.output).toContain("gateway01.eu-central-1.prod.aws.tidbcloud.com:4000");
    expect(result.output).toContain("TIDB_DEV_DATABASE_URL");
  });

  it("still says nothing about the user or the password", () => {
    // The same redaction discipline as test/destructive-guard.ts: host and
    // database are not secrets and naming them is what makes this actionable;
    // everything before the last '@' is the credential.
    const result = derive(dsn("somnus_consent"));

    expect(result.output).not.toContain(PASSWORD);
    expect(result.output).not.toContain(USER);
  });
});

describe("it fails closed", () => {
  it.each([
    ["empty", ""],
    ["unset", undefined],
  ])("fails when DATABASE_URL is %s", (_label, value) => {
    const result = derive(value);

    expect(result.status).not.toBe(0);
    expect(result.env.has("CONSENT_DATABASE_URL")).toBe(false);
  });

  it("fails on a connection string with no database at all", () => {
    const result = derive(`mysql://${USER}:${PASSWORD}@${HOST}`);

    expect(result.status).not.toBe(0);
    expect(result.env.has("CONSENT_DATABASE_URL")).toBe(false);
  });
});

describe("nothing downstream can run on a failed derivation", () => {
  it("leaves GITHUB_ENV empty, so a later step has no consent target to use", () => {
    // `set -euo pipefail` plus a non-zero exit is what stops the job here; the
    // point of asserting on the file is that a half-written GITHUB_ENV would let
    // the suite start against whatever was left behind.
    const result = derive(dsn("test"));

    expect(result.status).not.toBe(0);
    expect([...result.env.keys()]).toEqual([]);
  });
});
