import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  describeUnhandledError,
  scrubMessage,
} from "../../src/common/filters/describe-unhandled-error.js";

/**
 * What the exception filter is allowed to say about an error nothing handled.
 *
 * Two properties, asserted separately because they fail separately:
 *  - the driver's diagnosis (`code`, `errno`, `sqlState`) reaches the log, read
 *    off `.cause` where Drizzle puts it;
 *  - a credential, a bound parameter, or mysql2's value-formatted `.sql` never
 *    does.
 *
 * The real `DrizzleQueryError` from drizzle-orm is used, not a look-alike: its
 * message is `Failed query: …\nparams: …`, and that exact shape is the leak.
 */

/** A mysql2-shaped driver error: what Drizzle receives and stores as `.cause`. */
function driverError(
  message: string,
  fields: { code?: string; errno?: number; sqlState?: string; sql?: string },
): Error {
  return Object.assign(new Error(message), fields);
}

const PASSWORD = "S3cretPassw0rd";
const DB_USER = "4JdTF3GpJN7acjW.root";
const EMAIL = "alice@example.com";
const DSN = `mysql://${DB_USER}:${PASSWORD}@gateway01.example.com:4000/somnus_identity`;

describe("a DrizzleQueryError", () => {
  const cause = driverError("Table 'somnus_audit.legal_documents' doesn't exist", {
    code: "ER_NO_SUCH_TABLE",
    errno: 1146,
    sqlState: "42S02",
    // mysql2 can carry the statement with its values already formatted in.
    sql: `select * from legal_documents where email = '${EMAIL}'`,
  });
  const error = new DrizzleQueryError(
    "select `id` from `legal_documents` where `legal_documents`.`purpose_key` = ? limit ?",
    [EMAIL, "tok_live_abc123", 1],
    cause,
  );
  const line = describeUnhandledError(error);

  it("is named for what it is, not as a plain Error", () => {
    // DrizzleQueryError never sets `.name`, so `error.name` is "Error".
    expect(line.startsWith("DrizzleQueryError ")).toBe(true);
  });

  it("carries the driver code, errno and sqlState from its cause", () => {
    expect(line).toContain("code=ER_NO_SUCH_TABLE");
    expect(line).toContain("errno=1146");
    expect(line).toContain("sqlState=42S02");
  });

  it("keeps the schema object the driver named, which is the diagnosis", () => {
    // On 2026-09-19 this exact name is what would have shown the DSN pointed at
    // somnus_audit -- had it been logged.
    expect(line).toContain("somnus_audit.legal_documents");
  });

  it("logs the SQL text, which carries placeholders and not values", () => {
    expect(line).toContain("`legal_documents`.`purpose_key` = ? limit ?");
  });

  it("never logs a bound parameter", () => {
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain("tok_live_abc123");
    expect(line).not.toContain("params:");
  });

  it("never logs mysql2's value-formatted .sql", () => {
    expect(line).not.toContain("where email =");
  });
});

describe("credentials never reach the line", () => {
  it("redacts the userinfo of a DSN in a cause's message", () => {
    const line = describeUnhandledError(
      new DrizzleQueryError("select 1", [], driverError(`connect failed: ${DSN}`, {})),
    );
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(DB_USER);
    expect(line).toContain("mysql://<redacted>@gateway01.example.com:4000/somnus_identity");
  });

  it("redacts the user and host of an access-denied error, keeping its code", () => {
    const line = describeUnhandledError(
      new DrizzleQueryError(
        "select 1",
        [],
        driverError(`Access denied for user '${DB_USER}'@'10.0.0.7' (using password: YES)`, {
          code: "ER_ACCESS_DENIED_ERROR",
          errno: 1045,
          sqlState: "28000",
        }),
      ),
    );
    expect(line).toContain("code=ER_ACCESS_DENIED_ERROR");
    expect(line).toContain("errno=1045");
    expect(line).toContain("sqlState=28000");
    expect(line).not.toContain(DB_USER);
    expect(line).not.toContain("10.0.0.7");
  });

  it("redacts a DSN in a top-level message too, not only in causes", () => {
    const line = describeUnhandledError(new Error(`pool init failed for ${DSN}`));
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain(DB_USER);
  });

  it.each([
    ["password=", `password=${PASSWORD}`],
    ["token:", `token: ${PASSWORD}`],
    ["Bearer", `Authorization: Bearer ${PASSWORD}`],
    ["a JWT", "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4eXoifQ.c2lnbmF0dXJlLXZhbHVl"],
  ])("redacts %s", (_label, secret) => {
    const line = scrubMessage(`request failed: ${secret}`);
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain("eyJhbGciOiJSUzI1NiJ9");
  });
});

describe("user data MySQL echoes back in its messages", () => {
  it("redacts a duplicate-entry value but keeps the key name", () => {
    const line = describeUnhandledError(
      new DrizzleQueryError(
        "insert into `users` (`email`) values (?)",
        [EMAIL],
        driverError(`Duplicate entry '${EMAIL}' for key 'users.users_email_unique'`, {
          code: "ER_DUP_ENTRY",
          errno: 1062,
          sqlState: "23000",
        }),
      ),
    );
    expect(line).not.toContain(EMAIL);
    expect(line).toContain("users.users_email_unique");
    expect(line).toContain("code=ER_DUP_ENTRY");
  });

  it("redacts an incorrect-value literal", () => {
    expect(scrubMessage("Incorrect integer value: 'Alice' for column 'age' at row 1")).toBe(
      "Incorrect integer value: '<redacted>' for column 'age' at row 1",
    );
  });

  it("redacts any quoted literal that is not a schema object name", () => {
    expect(scrubMessage("lookup failed for 'alice smith'")).toBe("lookup failed for '<redacted>'");
  });

  it("does not mistake a contraction for the start of a quoted literal", () => {
    // Without the contraction rule, "Can't … on 'host'" pairs the apostrophe in
    // "Can't" with the next quote and mangles the whole message.
    expect(scrubMessage("Can't connect to MySQL server on 'dbhost'")).toBe(
      "Can’t connect to MySQL server on 'dbhost'",
    );
  });

  it("cuts anything after params:, wherever a wrapped Drizzle message surfaces", () => {
    expect(scrubMessage(`Failed query: select 1\nparams: ${EMAIL},1`)).toBe(
      "Failed query: select 1",
    );
  });
});

describe("network and driver errors that are not query failures", () => {
  it("keeps a connection error's code and numeric errno", () => {
    const line = describeUnhandledError(
      driverError("connect ETIMEDOUT", { code: "ETIMEDOUT", errno: -110 }),
    );
    expect(line).toContain("code=ETIMEDOUT");
    expect(line).toContain("errno=-110");
  });

  it("drops a .code that is free text rather than a driver token", () => {
    const line = describeUnhandledError(
      Object.assign(new Error("boom"), { code: `contact ${EMAIL} for help` }),
    );
    expect(line).not.toContain("code=");
    expect(line).not.toContain(EMAIL);
  });

  it("reads codes off a plain-object cause", () => {
    const error = new Error("wrapped", { cause: { code: "ECONNRESET", errno: -104 } });
    expect(describeUnhandledError(error)).toContain("cause: object code=ECONNRESET errno=-104");
  });
});

describe("it always terminates and never says more than it should", () => {
  it("describes a thrown non-Error by its type only", () => {
    expect(describeUnhandledError(`secret ${PASSWORD}`)).toBe("non-Error value thrown (string)");
    expect(describeUnhandledError(null)).toBe("non-Error value thrown (null)");
    expect(describeUnhandledError({ dsn: DSN })).toBe("non-Error value thrown (object)");
  });

  it("stops at a cause cycle", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });
    expect(describeUnhandledError(a)).toContain("cause: (cycle)");
  });

  it("follows at most three causes", () => {
    let error = new Error("level-5");
    for (let level = 4; level >= 0; level--) {
      error = new Error(`level-${level}`, { cause: error });
    }
    const line = describeUnhandledError(error);
    expect(line).toContain("level-3");
    expect(line).not.toContain("level-4");
  });

  it("bounds the message length", () => {
    const line = scrubMessage("x ".repeat(1000));
    expect(line.length).toBeLessThanOrEqual(301);
  });

  it("never includes a stack trace", () => {
    const error = new Error("plain");
    expect(describeUnhandledError(error)).not.toContain("    at ");
  });
});
