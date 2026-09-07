import { describe, expect, it } from "vitest";
import {
  ALLOWED_DATABASES,
  assertDestructiveTargetAllowed,
  DESTRUCTIVE_HOSTS_ENV,
  DESTRUCTIVE_OPT_IN_ENV,
  DestructiveTestGuardError,
} from "../destructive-guard.js";

/**
 * The interlock on the destructive test setup.
 *
 * `global-setup.ts` drops every table in its target database. These prove the
 * guard refuses anything it cannot positively recognise as disposable -- and
 * that it refuses by throwing, before a connection is ever opened, rather than
 * by hoping the DSN it was handed was the right one.
 *
 * A dev-shaped DSN is used throughout: it is not a credential, and no real one
 * appears in this repository.
 */
const DEV_HOST = "dev-cluster.example-db.internal";
const dsn = (host: string, database: string) =>
  `mysql://tester:not-a-real-password@${host}:4000/${database}`;

/** The environment a legitimate CI or local run provides. */
const allowedEnv = {
  [DESTRUCTIVE_OPT_IN_ENV]: "1",
  [DESTRUCTIVE_HOSTS_ENV]: DEV_HOST,
} as NodeJS.ProcessEnv;

describe("the opt-in is mandatory", () => {
  it.each([
    ["unset", {} as NodeJS.ProcessEnv],
    ["0", { [DESTRUCTIVE_OPT_IN_ENV]: "0" } as NodeJS.ProcessEnv],
    ["empty", { [DESTRUCTIVE_OPT_IN_ENV]: "" } as NodeJS.ProcessEnv],
    ["true", { [DESTRUCTIVE_OPT_IN_ENV]: "true" } as NodeJS.ProcessEnv],
    ["yes", { [DESTRUCTIVE_OPT_IN_ENV]: "yes" } as NodeJS.ProcessEnv],
  ])("refuses when %s, even for a perfectly legitimate local target", (_label, env) => {
    // Loopback, an owned database: everything else about this is fine. Running
    // a test command must still never be enough on its own.
    expect(() =>
      assertDestructiveTargetAllowed(dsn("127.0.0.1", "somnus_identity"), "identity", env),
    ).toThrow(DestructiveTestGuardError);
  });

  it("says which variable is missing, so the refusal is actionable", () => {
    expect(() =>
      assertDestructiveTargetAllowed(dsn("127.0.0.1", "somnus_identity"), "identity", {}),
    ).toThrow(new RegExp(DESTRUCTIVE_OPT_IN_ENV));
  });
});

describe("the database must be one this suite owns", () => {
  it.each([
    "somnus_morpheo",
    "somnus_reporting",
    "somnus_notifications",
    "somnus_audit",
    "mysql",
    "information_schema",
    "somnus_identity_prod",
    "production",
  ])("refuses %s even on loopback with the opt-in set", (database) => {
    expect(() =>
      assertDestructiveTargetAllowed(dsn("127.0.0.1", database), "identity", allowedEnv),
    ).toThrow(DestructiveTestGuardError);
  });

  it.each([...ALLOWED_DATABASES])("accepts %s on loopback", (database) => {
    expect(() =>
      assertDestructiveTargetAllowed(dsn("localhost", database), "identity", allowedEnv),
    ).not.toThrow();
  });
});

describe("a non-loopback host must be named deliberately", () => {
  it("refuses a remote host that is not listed, whatever the database is called", () => {
    expect(() =>
      assertDestructiveTargetAllowed(
        dsn("some-cluster.example.com", "somnus_identity"),
        "identity",
        allowedEnv,
      ),
    ).toThrow(DestructiveTestGuardError);
  });

  it("refuses a remote host when the allowlist is empty, even with the opt-in set", () => {
    expect(() =>
      assertDestructiveTargetAllowed(dsn(DEV_HOST, "somnus_identity"), "identity", {
        [DESTRUCTIVE_OPT_IN_ENV]: "1",
      } as NodeJS.ProcessEnv),
    ).toThrow(DestructiveTestGuardError);
  });

  it("accepts a remote host that IS listed", () => {
    expect(() =>
      assertDestructiveTargetAllowed(dsn(DEV_HOST, "somnus_identity"), "identity", allowedEnv),
    ).not.toThrow();
  });

  it("accepts one host out of a listed set, and still refuses the rest", () => {
    const env = {
      [DESTRUCTIVE_OPT_IN_ENV]: "1",
      [DESTRUCTIVE_HOSTS_ENV]: ` ${DEV_HOST} , other-dev.example.internal `,
    } as NodeJS.ProcessEnv;

    expect(() =>
      assertDestructiveTargetAllowed(dsn("other-dev.example.internal", "somnus_consent"), "c", env),
    ).not.toThrow();
    expect(() =>
      assertDestructiveTargetAllowed(
        dsn("not-listed.example.internal", "somnus_consent"),
        "c",
        env,
      ),
    ).toThrow(DestructiveTestGuardError);
  });

  it("matches hosts case-insensitively, so casing is never the thing that saves or dooms a run", () => {
    const env = {
      [DESTRUCTIVE_OPT_IN_ENV]: "1",
      [DESTRUCTIVE_HOSTS_ENV]: DEV_HOST.toUpperCase(),
    } as NodeJS.ProcessEnv;
    expect(() =>
      assertDestructiveTargetAllowed(dsn(DEV_HOST, "somnus_identity"), "identity", env),
    ).not.toThrow();
  });
});

describe("it fails closed, never open", () => {
  it.each(["", "not-a-url", "mysql://", "somnus_identity", "://host/db"])(
    "refuses an unparseable connection string (%s)",
    (value) => {
      expect(() => assertDestructiveTargetAllowed(value, "identity", allowedEnv)).toThrow(
        DestructiveTestGuardError,
      );
    },
  );

  it("refuses a DSN with a host but no database", () => {
    expect(() =>
      assertDestructiveTargetAllowed("mysql://u:p@127.0.0.1:3306/", "identity", allowedEnv),
    ).toThrow(DestructiveTestGuardError);
  });
});

describe("a refusal never leaks a credential", () => {
  it("names the host and database, and nothing from the userinfo", () => {
    const secret = "s3cr3t-password-value";
    const target = `mysql://admin:${secret}@prod-db.example.com:4000/somnus_identity`;

    let message = "";
    try {
      assertDestructiveTargetAllowed(target, "identity", allowedEnv);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toBe("");
    expect(message).not.toContain(secret);
    expect(message).not.toContain("admin");
    // The host and database are not secrets, and naming them is what makes the
    // refusal debuggable.
    expect(message).toContain("prod-db.example.com");
  });
});
