import { afterEach, describe, expect, it } from "vitest";
import { assertTargetsAreDistinct, DestructiveTestGuardError } from "../destructive-guard.js";
import setup from "../global-setup.js";

/**
 * The guard against dropping one database twice.
 *
 * `global-setup.ts` drops every table in the identity target, migrates it, then
 * does the same for consent. Each drop is scoped by MySQL's `DATABASE()`, which
 * is what keeps the two apart -- right up until both DSNs name one database, at
 * which point the consent pass deletes the identity tables the identity pass
 * just created and the run carries on into a half-missing schema.
 *
 * This is not hypothetical. CI derives the consent DSN from identity's by
 * literal substitution, so a DATABASE_URL whose path is not exactly
 * `/somnus_identity` makes the substitution a no-op and collapses the two. The
 * failure then surfaced files later, as a DELETE against a table that no longer
 * existed, in a suite that had touched nothing related.
 *
 * The pre-existing checks cannot catch it: both names are on the allowlist, so
 * an identical pair passes every one of them.
 */
const dsn = (host: string, database: string, port = "4000") =>
  `mysql://tester:not-a-real-password@${host}:${port}/${database}`;

describe("two targets that are the same database", () => {
  it("are refused even though each one is individually legitimate", () => {
    const both = dsn("dev-cluster.example.internal", "somnus_consent");

    expect(() => assertTargetsAreDistinct(both, both)).toThrow(DestructiveTestGuardError);
  });

  it("are refused for the exact shape CI's derivation produces", () => {
    // `sed s#/somnus_identity#/somnus_consent#` is a no-op on this path, so both
    // variables come out identical. This is the shape that actually broke CI.
    const identity = dsn("gateway01.eu-central-1.prod.aws.tidbcloud.com", "test");
    const consent = identity.replace("/somnus_identity", "/somnus_consent");

    expect(consent).toBe(identity);
    expect(() => assertTargetsAreDistinct(identity, consent)).toThrow(DestructiveTestGuardError);
  });

  it("name the database in the refusal, and no credential", () => {
    const both = dsn("dev.example.internal", "somnus_identity");
    let message = "";
    try {
      assertTargetsAreDistinct(both, both);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("dev.example.internal:4000/somnus_identity");
    expect(message).not.toContain("not-a-real-password");
    expect(message).not.toContain("tester");
  });

  it("are still the same database when only the host casing differs", () => {
    const identity = dsn("Dev-Cluster.Example.Internal", "somnus_identity");
    const consent = dsn("dev-cluster.example.internal", "somnus_identity");

    expect(() => assertTargetsAreDistinct(identity, consent)).toThrow(DestructiveTestGuardError);
  });
});

describe("two targets that are genuinely different", () => {
  it("are allowed when the database differs", () => {
    expect(() =>
      assertTargetsAreDistinct(
        dsn("dev.example.internal", "somnus_identity"),
        dsn("dev.example.internal", "somnus_consent"),
      ),
    ).not.toThrow();
  });

  it("are allowed when the host differs", () => {
    expect(() =>
      assertTargetsAreDistinct(
        dsn("identity.example.internal", "somnus_identity"),
        dsn("consent.example.internal", "somnus_identity"),
      ),
    ).not.toThrow();
  });

  it("are allowed when only the port differs, since that is a different server", () => {
    expect(() =>
      assertTargetsAreDistinct(
        dsn("dev.example.internal", "somnus_identity", "4000"),
        dsn("dev.example.internal", "somnus_identity", "4001"),
      ),
    ).not.toThrow();
  });
});

describe("it fails closed, never open", () => {
  it.each(["", "not-a-url", "mysql://", "mysql://host-with-no-database"])(
    "refuses when a target cannot be located (%s)",
    (value) => {
      expect(() =>
        assertTargetsAreDistinct(value, dsn("dev.example.internal", "somnus_consent")),
      ).toThrow(DestructiveTestGuardError);
      expect(() =>
        assertTargetsAreDistinct(dsn("dev.example.internal", "somnus_identity"), value),
      ).toThrow(DestructiveTestGuardError);
    },
  );
});

/**
 * The rule proven where it matters: on `setup()` itself.
 *
 * Loopback is used so the opt-in and host-allowlist checks pass and execution
 * actually reaches the distinctness check -- otherwise this would pass for the
 * wrong reason. A DestructiveTestGuardError rather than a connection error is
 * what shows it stopped before opening a pool.
 */
const ORIGINAL = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

describe("global-setup refuses before it drops anything", () => {
  it("aborts when both DSNs point at one database", async () => {
    const both = "mysql://u:p@127.0.0.1:3306/somnus_identity";
    Object.assign(process.env, {
      SOMNUS_ALLOW_DESTRUCTIVE_TESTS: "1",
      SOMNUS_DESTRUCTIVE_TEST_HOSTS: "127.0.0.1",
      DATABASE_URL: both,
      CONSENT_DATABASE_URL: both,
    });

    await expect(setup()).rejects.toBeInstanceOf(DestructiveTestGuardError);
  });

  it("still proceeds past the guard when the two are distinct", async () => {
    // Distinct, allowlisted, and unreachable on purpose (.invalid, RFC 2606).
    // Reaching a connection error is the assertion: it proves the guard let a
    // legitimate pair through rather than refusing everything.
    Object.assign(process.env, {
      SOMNUS_ALLOW_DESTRUCTIVE_TESTS: "1",
      SOMNUS_DESTRUCTIVE_TEST_HOSTS: "dev.invalid",
      DATABASE_URL: "mysql://u:p@dev.invalid:4000/somnus_identity",
      CONSENT_DATABASE_URL: "mysql://u:p@dev.invalid:4000/somnus_consent",
    });

    await expect(setup()).rejects.not.toBeInstanceOf(DestructiveTestGuardError);
  });
});
