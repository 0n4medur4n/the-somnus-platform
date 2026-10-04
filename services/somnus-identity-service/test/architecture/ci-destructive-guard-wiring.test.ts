import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DESTRUCTIVE_HOSTS_ENV,
  DESTRUCTIVE_OPT_IN_ENV,
  LOOPBACK_HOSTS,
} from "../destructive-guard.js";

/**
 * The wiring between the CI workflow and the destructive guard.
 *
 * `global-setup.ts` drops **every table** in the database `ci.yml` hands it.
 * Those are two files that know each other only by string, and nothing else in
 * the build would notice if the strings stopped agreeing. So the names and the
 * loopback list here are imported from the guard, never typed again.
 *
 * ## What changed on 2026-09-19, and why this file got stricter
 *
 * This job used to run against the shared TiDB Cloud dev cluster, guarded by a
 * host allowlist fed from `vars.TIDB_DEV_HOST`. The guard worked exactly as
 * designed -- and that was the problem. The dev cluster was on the allowlist
 * deliberately, so every push to `main` dropped every table in the same
 * `somnus_identity` that real people register into. An account, and any
 * `platform_super_admin` grant on it, could not outlive the next commit.
 *
 * No assertion in the previous version of this file could have caught that,
 * because nothing was misconfigured. The allowlist was doing its job; the job
 * was simply pointed somewhere it should never have been pointed.
 *
 * So these tests no longer check that a remote target is *allowed*. They check
 * that there is no remote target:
 *
 *  1. the destructive job's databases are on loopback, per the guard's own
 *     `LOOPBACK_HOSTS` -- which cannot be production by construction;
 *  2. it declares no `environment:`, so it cannot inherit a credential to a
 *     real database from a GitHub Environment;
 *  3. no job anywhere in the workflow references `TIDB_DEV_DATABASE_URL`;
 *  4. it does not set a host allowlist, because needing one would mean the
 *     target had stopped being loopback.
 *
 * The check is over the workflow SOURCE rather than a parsed object because the
 * repository has no YAML parser and this does not warrant adding one -- the same
 * approach the other architectural tests take (`no-tidb.arch.test.ts`).
 */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const WORKFLOW_PATH = `${repoRoot}.github/workflows/ci.yml`;
const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const lines = workflow.split("\n");

/**
 * The workflow with full-line `#` comments removed.
 *
 * Needed because the assertions below look for the *absence* of certain names,
 * and the job now carries comments explaining why those names are absent. A
 * comment cannot wire a credential into a job, so searching the commentary for
 * forbidden strings would only ever produce a false failure -- and would create
 * pressure to delete the very explanation that stops someone re-adding them.
 *
 * Full-line comments only: an inline `#` cannot be told from a `#` inside a
 * quoted value without a YAML parser, and no value in this workflow contains one.
 */
const executable = lines.filter((line) => !/^\s*#/.test(line)).join("\n");

type Job = { name: string; body: string };

/** Splits the workflow into its jobs. A job is a 2-space-indented key under `jobs:`. */
function readJobs(source: string): Job[] {
  const jobs: Job[] = [];
  const sourceLines = source.split("\n");
  const jobStart = /^ {2}([A-Za-z0-9_-]+):\s*$/;

  for (let i = 0; i < sourceLines.length; i++) {
    const match = jobStart.exec(sourceLines[i] ?? "");
    if (!match) continue;
    const name = match[1] ?? "";

    let end = sourceLines.length;
    for (let j = i + 1; j < sourceLines.length; j++) {
      const line = sourceLines[j] ?? "";
      if (line.trim().length === 0) continue;
      // The next 2-space-indented key ends this job's block.
      if (/^ {2}\S/.test(line)) {
        end = j;
        break;
      }
    }
    jobs.push({ name, body: sourceLines.slice(i, end).join("\n") });
  }
  return jobs;
}

const jobs = readJobs(executable);

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

/** Reads a top-level `env:` entry out of a job body. */
function envValue(job: Job | undefined, key: string): string | null {
  const match = new RegExp(`^\\s+${key}:\\s*(.+)$`, "m").exec(job?.body ?? "");
  return match?.[1]?.trim() ?? null;
}

/** The hostname of a DSN, or null when it is not a parseable URL. */
function hostOf(dsn: string): string | null {
  try {
    return new URL(dsn).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The DSNs the destructive setup opens, and therefore drops every table in. */
const DESTRUCTIVE_DSN_VARS = ["DATABASE_URL", "CONSENT_DATABASE_URL"] as const;

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
    const optIn = envValue(job, DESTRUCTIVE_OPT_IN_ENV);

    expect(
      optIn,
      `${name} does not set ${DESTRUCTIVE_OPT_IN_ENV}; the guard would refuse and CI would go red`,
    ).not.toBeNull();
    // The guard compares against the string "1". `true`, `yes` and `on` all fail
    // it, and YAML happily turns unquoted `1` into a number.
    expect(optIn, `${DESTRUCTIVE_OPT_IN_ENV} must be the string "1"`).toBe('"1"');
  });
});

describe("the destructive suite can only ever destroy a disposable database", () => {
  it.each(destructiveJobs.map((job) => job.name))(
    "%s points every destructive DSN at loopback",
    (name) => {
      const job = destructiveJobs.find((candidate) => candidate.name === name);

      for (const key of DESTRUCTIVE_DSN_VARS) {
        const dsn = envValue(job, key);
        expect(
          dsn,
          `${name} does not set ${key}. The destructive setup would fall back to the schema ` +
            "default, and what this job drops would not be readable in the workflow",
        ).not.toBeNull();

        const host = hostOf(dsn ?? "");
        expect(host, `${name}'s ${key} is not a parseable DSN: ${dsn}`).not.toBeNull();
        expect(
          LOOPBACK_HOSTS,
          `${name}'s ${key} targets "${host}", which is not loopback. This job drops EVERY ` +
            "TABLE in that database on every push. Until 2026-09-19 it pointed at the shared " +
            "TiDB dev cluster and was deleting real accounts, including any platform_super_admin " +
            "grant. A destructive target must be a container that dies with the run",
        ).toContain(host);
      }
    },
  );

  it.each(destructiveJobs.map((job) => job.name))(
    "%s keeps its two destructive targets distinct",
    (name) => {
      const job = destructiveJobs.find((candidate) => candidate.name === name);
      const [identity, consent] = DESTRUCTIVE_DSN_VARS.map((key) => envValue(job, key));

      // The same property test/destructive-guard.ts enforces at runtime
      // (assertTargetsAreDistinct), asserted here where it is cheap: if both
      // names collapse into one database, the consent pass drops the tables the
      // identity pass has just migrated and the run dies files later.
      expect(
        identity,
        `${name} opens one database twice; the second wipe would undo the first migration`,
      ).not.toBe(consent);
    },
  );

  it.each(destructiveJobs.map((job) => job.name))(
    "%s declares no GitHub Environment, so it cannot inherit a real database credential",
    (name) => {
      const job = destructiveJobs.find((candidate) => candidate.name === name);
      // `environment: dev` is what used to put TIDB_DEV_DATABASE_URL within this
      // job's reach. With a loopback target it has nothing to gain from an
      // Environment, and an Environment is exactly how a real credential would
      // find its way back in.
      expect(
        job?.body,
        `${name} declares a GitHub Environment. The job that drops every table must not be ` +
          "able to read an Environment's credentials",
      ).not.toMatch(/^\s+environment:\s*\S/m);
    },
  );

  it.each(destructiveJobs.map((job) => job.name))(
    "%s does not set a host allowlist, because it has no remote host to allow",
    (name) => {
      const job = destructiveJobs.find((candidate) => candidate.name === name);
      // The guard short-circuits on loopback before it reads this variable, so
      // setting it would be dead configuration -- and a variable named
      // "destructive test hosts" holding a real hostname is precisely what made
      // the 2026-09-19 data loss reachable. Its absence makes the guard fail
      // closed on any future non-loopback target.
      expect(
        envValue(job, DESTRUCTIVE_HOSTS_ENV),
        `${name} sets ${DESTRUCTIVE_HOSTS_ENV}. On a loopback target the guard never reads it, ` +
          "so its presence means either dead configuration or a target that is no longer local. " +
          "Neither belongs in the job that drops every table",
      ).toBeNull();
    },
  );
});

describe("no push-triggered job can reach the real dev database", () => {
  it("nothing in the workflow references TIDB_DEV_DATABASE_URL", () => {
    // Asserted over the whole workflow, not just the destructive job: the point
    // is that a routine push cannot touch the database people register into,
    // whichever job would have done the touching.
    expect(
      executable,
      "ci.yml references TIDB_DEV_DATABASE_URL. CI must not hold a credential to the dev " +
        "identity database on a push; that is what let it delete real accounts until " +
        "2026-09-19. Real-TiDB coverage, if it is ever wanted again, belongs in a " +
        "workflow_dispatch-only job that is not part of the push path",
    ).not.toContain("TIDB_DEV_DATABASE_URL");
  });

  it("no job grants permission to drop tables beyond the one that needs it", () => {
    const others = jobs
      .filter((job) => !destructiveJobs.some((d) => d.name === job.name))
      .filter((job) => job.body.includes(DESTRUCTIVE_OPT_IN_ENV))
      .map((job) => job.name);

    expect(others, "only the job that runs the destructive suite may set the opt-in").toEqual([]);
  });
});

describe("the guard's variable names are the ones the workflow uses", () => {
  it("the opt-in name appears verbatim in ci.yml", () => {
    // The import at the top of this file is the guard's own constant. If it is
    // renamed and the workflow is not updated, this is the failure that says so
    // -- in this repository, at build time, instead of in a red CI run whose
    // error mentions a variable nobody recognises.
    //
    // Its companion DESTRUCTIVE_HOSTS_ENV is deliberately NOT asserted present:
    // the test above requires it to be absent. It is still imported, so renaming
    // it still breaks compilation here rather than silently.
    expect(executable, `ci.yml no longer mentions ${DESTRUCTIVE_OPT_IN_ENV}`).toContain(
      DESTRUCTIVE_OPT_IN_ENV,
    );
  });
});
