import { afterEach, describe, expect, it } from "vitest";
import { DestructiveTestGuardError } from "../destructive-guard.js";
import setup from "../global-setup.js";

/**
 * The guard proven where it actually matters: on `global-setup.ts` itself, the
 * function that issues the `DROP TABLE`s.
 *
 * `destructive-guard.test.ts` proves the rules. This proves they are *wired in
 * front of the drops* -- a correct guard that nobody calls protects nothing.
 *
 * Every target below is unreachable on purpose: `.invalid` is reserved by
 * RFC 2606 and cannot resolve. So if the guard ever stopped working, this test
 * would fail with a connection error instead of a `DestructiveTestGuardError`,
 * and the distinction is the assertion. Nothing here can reach a real database
 * even in the failure case.
 */
const ORIGINAL = { ...process.env };

function envFor(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  // Restore exactly, so the suite's own (legitimate) configuration survives.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL);
});

describe("global-setup refuses to run without the opt-in", () => {
  it.each([undefined, "0", ""])("aborts when the opt-in is %s", async (optIn) => {
    envFor({
      SOMNUS_ALLOW_DESTRUCTIVE_TESTS: optIn,
      SOMNUS_DESTRUCTIVE_TEST_HOSTS: "127.0.0.1",
      DATABASE_URL: "mysql://u:p@127.0.0.1:3306/somnus_identity",
      CONSENT_DATABASE_URL: "mysql://u:p@127.0.0.1:3306/somnus_consent",
    });

    // A DestructiveTestGuardError -- not a connection error -- is what proves it
    // stopped at the guard, before opening a pool.
    await expect(setup()).rejects.toBeInstanceOf(DestructiveTestGuardError);
  });
});

describe("global-setup refuses a target outside the allowlist", () => {
  it("aborts on a database this suite does not own", async () => {
    envFor({
      SOMNUS_ALLOW_DESTRUCTIVE_TESTS: "1",
      SOMNUS_DESTRUCTIVE_TEST_HOSTS: "prod-db.invalid",
      DATABASE_URL: "mysql://u:p@prod-db.invalid:4000/somnus_production",
      CONSENT_DATABASE_URL: "mysql://u:p@prod-db.invalid:4000/somnus_consent",
    });

    await expect(setup()).rejects.toBeInstanceOf(DestructiveTestGuardError);
  });

  it("aborts on an unlisted host even when the database name is one we own", async () => {
    envFor({
      SOMNUS_ALLOW_DESTRUCTIVE_TESTS: "1",
      SOMNUS_DESTRUCTIVE_TEST_HOSTS: undefined,
      DATABASE_URL: "mysql://u:p@prod-db.invalid:4000/somnus_identity",
      CONSENT_DATABASE_URL: "mysql://u:p@prod-db.invalid:4000/somnus_consent",
    });

    // This is the case the whole guard exists for: the DSN looks exactly like a
    // legitimate one, because production uses the same database names.
    await expect(setup()).rejects.toBeInstanceOf(DestructiveTestGuardError);
  });

  it("aborts when only the CONSENT target is out of bounds", async () => {
    envFor({
      SOMNUS_ALLOW_DESTRUCTIVE_TESTS: "1",
      SOMNUS_DESTRUCTIVE_TEST_HOSTS: "127.0.0.1",
      DATABASE_URL: "mysql://u:p@127.0.0.1:3306/somnus_identity",
      CONSENT_DATABASE_URL: "mysql://u:p@prod-db.invalid:4000/somnus_consent",
    });

    // Both targets are checked before either is touched: a run that is
    // half-legitimate must not wipe identity and only then refuse consent.
    await expect(setup()).rejects.toBeInstanceOf(DestructiveTestGuardError);
  });
});
