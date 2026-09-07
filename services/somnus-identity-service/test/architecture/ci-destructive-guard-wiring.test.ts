import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESTRUCTIVE_HOSTS_ENV, DESTRUCTIVE_OPT_IN_ENV } from "../destructive-guard.js";

/**
 * The wiring between the CI workflow and the destructive guard.
 *
 * `destructive-guard.ts` reads two environment variables and refuses to drop a
 * table without them. `ci.yml` is what supplies them. Those are two files that
 * know each other only by string, and nothing else in the build would notice if
 * the string stopped matching: the guard would simply refuse, and the identity
 * job would go red on every push with an error about a variable nobody had
 * touched.
 *
 * So the variable NAMES here are imported from the guard, not typed again. Rename
 * a constant in `destructive-guard.ts` without updating the workflow and this
 * fails, naming the mismatch, instead of CI failing tomorrow for a reason that
 * looks unrelated.
 *
 * The check is over the workflow SOURCE rather than a parsed object because the
 * repository has no YAML parser and this does not warrant adding one -- the same
 * approach the other architectural tests take (`no-tidb.arch.test.ts`).
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW_PATH = `${repoRoot}.github/workflows/ci.yml`;
const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const lines = workflow.split("\n");

type Job = { name: string; body: string };

/** Splits the workflow into its jobs. A job is a 2-space-indented key under `jobs:`. */
function readJobs(): Job[] {
  const jobs: Job[] = [];
  const jobStart = /^ {2}([A-Za-z0-9_-]+):\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const match = jobStart.exec(lines[i] ?? "");
    if (!match) continue;
    const name = match[1] ?? "";

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? "";
      if (line.trim().length === 0) continue;
      // The next 2-space-indented key ends this job's block.
      if (/^ {2}\S/.test(line)) {
        end = j;
        break;
      }
    }
    jobs.push({ name, body: lines.slice(i, end).join("\n") });
  }
  return jobs;
}

const jobs = readJobs();

/**
 * Jobs whose steps actually run the suite that triggers the destructive setup.
 *
 * Matches `test`, `test:coverage` and `test:watch` alike -- every one of them
 * goes through `global-setup.ts`. Both spellings of pnpm's filter flag are
 * accepted so that swapping `--filter` for `-F` is not reported as a missing
 * job. Anything else (a renamed script, a different runner) makes the
 * "exactly one job" assertion below fail loudly, which is the intended
 * outcome: how this suite gets invoked is not something to change without
 * revisiting what supplies its guard variables.
 */
const DESTRUCTIVE_SUITE = /pnpm\s+(?:--filter|-F)\s+@somnus\/identity-service\s+test/;
const destructiveJobs = jobs.filter((job) => DESTRUCTIVE_SUITE.test(job.body));

describe("the workflow is readable and still contains the job under test", () => {
  it("parsed a plausible set of jobs", () => {
    expect(jobs.length).toBeGreaterThan(5);
    expect(jobs.map((job) => job.name)).toContain("identity-service");
  });

  it("found exactly one job that runs the destructive suite", () => {
    // If this ever becomes more than one, every assertion below still applies to
    // each of them -- but it is worth knowing that the blast radius grew.
    expect(destructiveJobs.map((job) => job.name)).toEqual(["identity-service"]);
  });
});

describe("every job that runs the destructive suite supplies what the guard requires", () => {
  it.each(destructiveJobs.map((job) => job.name))('%s sets the opt-in to exactly "1"', (name) => {
    const job = destructiveJobs.find((candidate) => candidate.name === name);
    const optIn = new RegExp(`^\\s+${DESTRUCTIVE_OPT_IN_ENV}:\\s*(.+)$`, "m").exec(job?.body ?? "");

    expect(
      optIn,
      `${name} does not set ${DESTRUCTIVE_OPT_IN_ENV}; the guard would refuse and CI would go red`,
    ).not.toBeNull();
    // The guard compares against the string "1". `true`, `yes` and `on` all fail
    // it, and YAML happily turns unquoted `1` into a number.
    expect(optIn?.[1]?.trim(), `${DESTRUCTIVE_OPT_IN_ENV} must be the string "1"`).toBe('"1"');
  });

  it.each(destructiveJobs.map((job) => job.name))(
    "%s maps the host allowlist from a repository/environment variable",
    (name) => {
      const job = destructiveJobs.find((candidate) => candidate.name === name);
      const mapping = new RegExp(`^\\s+${DESTRUCTIVE_HOSTS_ENV}:\\s*(.+)$`, "m").exec(
        job?.body ?? "",
      );

      expect(
        mapping,
        `${name} does not set ${DESTRUCTIVE_HOSTS_ENV}. Without it the guard refuses every ` +
          "non-loopback target, so the job fails even when its database credential is correct",
      ).not.toBeNull();

      const value = mapping?.[1]?.trim() ?? "";
      // It must come from a configured Actions *variable*: a hostname is not a
      // secret, and hard-coding one here would put infrastructure detail in the
      // repository and silently survive an environment change.
      expect(
        value,
        `${DESTRUCTIVE_HOSTS_ENV} must be fed from a \${{ vars.* }} expression, got: ${value}`,
      ).toMatch(/^\$\{\{\s*vars\.[A-Z0-9_]+\s*\}\}$/);

      // An empty expression would evaluate to "" at runtime and refuse everything.
      expect(value).not.toMatch(/vars\.\s*\}\}/);
    },
  );

  it.each(destructiveJobs.map((job) => job.name))(
    "%s is bound to the dev Environment, so its credential is scoped there",
    (name) => {
      const job = destructiveJobs.find((candidate) => candidate.name === name);
      expect(
        job?.body,
        `${name} must declare \`environment: dev\` so TIDB_DEV_DATABASE_URL can live on that ` +
          "Environment rather than at repository level",
      ).toMatch(/^\s+environment:\s*dev\s*$/m);
    },
  );
});

describe("the destructive opt-in is not spread beyond the job that needs it", () => {
  it("no other job grants permission to drop tables", () => {
    const others = jobs
      .filter((job) => !destructiveJobs.some((d) => d.name === job.name))
      .filter((job) => job.body.includes(DESTRUCTIVE_OPT_IN_ENV))
      .map((job) => job.name);

    expect(others, "only the job that runs the destructive suite may set the opt-in").toEqual([]);
  });
});

describe("the guard's variable names are the ones the workflow uses", () => {
  it("both names appear verbatim in ci.yml", () => {
    // The imports at the top of this file are the guard's own constants. If one
    // is renamed and the workflow is not updated, this is the failure that says
    // so -- in this repository, at build time, instead of in a red CI run whose
    // error mentions a variable nobody recognises.
    expect(workflow, `ci.yml no longer mentions ${DESTRUCTIVE_OPT_IN_ENV}`).toContain(
      DESTRUCTIVE_OPT_IN_ENV,
    );
    expect(workflow, `ci.yml no longer mentions ${DESTRUCTIVE_HOSTS_ENV}`).toContain(
      DESTRUCTIVE_HOSTS_ENV,
    );
  });
});
