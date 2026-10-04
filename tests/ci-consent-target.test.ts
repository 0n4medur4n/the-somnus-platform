import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The identity job's two database targets, and the container they must exist in.
 *
 * ## What this replaces, and why
 *
 * This file used to be `ci-consent-derivation.test.ts`. It lifted the
 * `Derive CONSENT_DATABASE_URL` shell step out of `ci.yml` and ran it, because
 * the consent DSN was produced from identity's by substituting one path segment
 * (`s#/somnus_identity#/somnus_consent#`). When that substitution matched
 * nothing, both variables came out identical, both pools opened one database,
 * and `global-setup.ts` dropped the identity tables it had just migrated -- the
 * failure that kept the job red from 2026-08-26 to 2026-09-07.
 *
 * That step no longer exists. On 2026-09-19 the job moved off the shared TiDB
 * Cloud dev cluster onto a per-run MySQL 8.4 service container, and both DSNs
 * became literal loopback constants written out in the workflow. Deriving one
 * literal from another literal would be theatre, so the step went.
 *
 * The old file carried an instruction not to delete it if the step was renamed
 * or replaced, and that instruction is honoured here rather than worked around:
 * the property it protected -- **identity and consent must never be the same
 * database** -- is still asserted, against the wiring that actually exists now.
 * The runtime stop is unchanged and remains authoritative
 * (`assertTargetsAreDistinct` in
 * `services/somnus-identity-service/test/destructive-guard.ts`).
 *
 * One thing is asserted here that the old file could not check, because under a
 * derivation it was not expressible: that the databases the job's DSNs name are
 * the same ones its `Create logical databases` step actually creates. Those are
 * now two independent literals in the same file, and nothing else would notice
 * them drifting apart -- the suite would simply fail on a database that was
 * never created.
 *
 * Read over the workflow source rather than a parsed object: the repository has
 * no YAML parser and this does not warrant adding one, matching
 * `services/somnus-identity-service/test/architecture/*`.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const workflow = readFileSync(`${REPO_ROOT}.github/workflows/ci.yml`, "utf8");

/** The `identity-service` job block, from its key to the next job's. */
function identityJob(): string {
  const lines = workflow.split("\n");
  const start = lines.indexOf("  identity-service:");
  if (start === -1) throw new Error("the identity-service job is gone from ci.yml");

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) continue;
    if (/^ {2}\S/.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const job = identityJob();

/** A top-level `env:` value from the job. */
function envValue(key: string): string | null {
  const match = new RegExp(`^\\s+${key}:\\s*(.+)$`, "m").exec(job);
  return match?.[1]?.trim() ?? null;
}

/** The database segment of a DSN, without any query string. */
function databaseOf(dsn: string): string {
  return new URL(dsn).pathname.replace(/^\//, "").replace(/\?.*$/, "");
}

const IDENTITY_DSN = envValue("DATABASE_URL");
const CONSENT_DSN = envValue("CONSENT_DATABASE_URL");

describe("the job declares both database targets outright", () => {
  it.each([
    ["DATABASE_URL", IDENTITY_DSN],
    ["CONSENT_DATABASE_URL", CONSENT_DSN],
  ])("%s is set", (key, value) => {
    expect(
      value,
      `${key} is not set on the identity job. It would fall back to the schema default, and ` +
        "what this job drops every table in would not be readable in the workflow",
    ).not.toBeNull();
  });

  it.each([
    ["DATABASE_URL", IDENTITY_DSN],
    ["CONSENT_DATABASE_URL", CONSENT_DSN],
  ])("%s is a literal, not an expression fed from a secret", (key, value) => {
    // A `${{ secrets.* }}` expression here would mean the job that drops every
    // table holds a credential to a database someone else is using. That is the
    // shape this job had until 2026-09-19, and it was deleting real accounts.
    expect(
      value,
      `${key} is a GitHub expression. The destructive job's targets must be literal and local`,
    ).not.toMatch(/\$\{\{/);
  });

  it("no derivation step remains that could collapse the two into one", () => {
    // The derivation is what made a one-character mistake able to point both
    // pools at one database. With two literals there is nothing to derive, and
    // re-adding a derivation would reintroduce exactly that failure mode.
    expect(
      job,
      "a `Derive CONSENT_DATABASE_URL` step is back in the identity job. Both DSNs are " +
        "literals now; deriving one from the other is how they collapsed into a single " +
        "database and stayed that way for twelve days in 2026",
    ).not.toContain("Derive CONSENT_DATABASE_URL");
  });
});

describe("the two targets are genuinely different databases", () => {
  it("names somnus_identity and somnus_consent", () => {
    expect(databaseOf(IDENTITY_DSN ?? "")).toBe("somnus_identity");
    expect(databaseOf(CONSENT_DSN ?? "")).toBe("somnus_consent");
  });

  it("differ in the database segment and nowhere else", () => {
    // Same container, same credentials, different logical database -- the dev
    // and CI simplification documented in consent-db.config.ts. Production
    // provisions a genuinely separate user (build plan §8), which is a
    // different shape and not what this asserts.
    const identity = new URL(IDENTITY_DSN ?? "");
    const consent = new URL(CONSENT_DSN ?? "");

    expect(consent.host).toBe(identity.host);
    expect(consent.username).toBe(identity.username);
    expect(consent.pathname).not.toBe(identity.pathname);
  });

  it("are not the same DSN", () => {
    // The property `assertTargetsAreDistinct` enforces at runtime, asserted here
    // where it costs nothing: if both names open one database, the consent pass
    // drops the tables the identity pass has just migrated, and the run dies
    // files later on a table that pointed at nothing in particular.
    expect(CONSENT_DSN).not.toBe(IDENTITY_DSN);
  });
});

describe("the databases the DSNs name are the ones the job creates", () => {
  /** The `CREATE DATABASE IF NOT EXISTS <name>` targets in the job's setup step. */
  const created = [...job.matchAll(/CREATE DATABASE IF NOT EXISTS\s+(\w+)/g)].map(
    (match) => match[1],
  );

  it("creates at least one database", () => {
    // Guards the regex itself: an empty list would make every assertion below
    // pass vacuously.
    expect(created.length).toBeGreaterThan(0);
  });

  it.each([
    ["DATABASE_URL", IDENTITY_DSN],
    ["CONSENT_DATABASE_URL", CONSENT_DSN],
  ])("creates the database %s points at", (key, dsn) => {
    const database = databaseOf(dsn ?? "");
    expect(
      created,
      `${key} points at "${database}", which the "Create logical databases" step does not ` +
        "create. The suite would fail on a database that never existed, and the error would " +
        "name the query rather than the workflow line that is actually wrong",
    ).toContain(database);
  });
});
