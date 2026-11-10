import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cookieSecretProblem,
  DEVELOPMENT_COOKIE_SECRET,
  EdgeConfigSchema,
  loadEdgeConfig,
} from "../../src/config/edge-config.js";

/**
 * The session cookie's secret fails closed.
 *
 * Until now a missing COOKIE_SECRET silently became a string that is public in
 * the repository, so a deployed service that lost its secret would have signed
 * every session with a key anyone could read. Outside local development the
 * service must now refuse to start instead.
 */

const strong = () => randomBytes(24).toString("base64url"); // 32 characters
const deployed = (extra: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  COOKIE_SECRET: strong(),
  COOKIE_SECURE: "true",
  COOKIE_SAMESITE: "lax",
  ...extra,
});

function problems(env: Record<string, string | undefined>): string[] {
  const result = EdgeConfigSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("cookie secret outside local development (fail closed)", () => {
  it("accepts a strong secret", () => {
    expect(problems(deployed())).toEqual([]);
  });

  it("refuses to start with no secret", () => {
    const env = deployed();
    delete (env as Record<string, string | undefined>)["COOKIE_SECRET"];
    expect(problems(env).join("\n")).toContain("COOKIE_SECRET: is required");
  });

  it("refuses an empty secret", () => {
    expect(problems(deployed({ COOKIE_SECRET: "" })).join("\n")).toContain("COOKIE_SECRET");
  });

  it("refuses a secret of 31 bytes and accepts one of exactly 32", () => {
    expect(problems(deployed({ COOKIE_SECRET: "k".repeat(31) })).join("\n")).toContain(
      "shorter than 32 bytes",
    );
    expect(problems(deployed({ COOKIE_SECRET: "k".repeat(32) }))).toEqual([]);
  });

  it("counts bytes, not characters", () => {
    // 16 two-byte characters are 32 bytes; 31 ASCII characters are 31.
    expect(problems(deployed({ COOKIE_SECRET: "é".repeat(16) }))).toEqual([]);
    expect(problems(deployed({ COOKIE_SECRET: "é".repeat(15) })).join("\n")).toContain(
      "shorter than 32 bytes",
    );
  });

  it.each([
    DEVELOPMENT_COOKIE_SECRET,
    "test-only-cookie-secret-0123456789",
    "unit-test-cookie-secret-0123456789",
  ])("refuses the development default %s", (secret) => {
    expect(problems(deployed({ COOKIE_SECRET: secret })).join("\n")).toContain(
      "development default or placeholder",
    );
  });

  it.each([
    "please-change-me-before-going-live-0001",
    "CHANGEME-CHANGEME-CHANGEME-CHANGEME",
    "an-insecure-secret-that-is-long-enough",
    "dev-only-secret-that-is-long-enough-ok",
  ])("refuses the placeholder %s", (secret) => {
    expect(problems(deployed({ COOKIE_SECRET: secret })).length).toBeGreaterThan(0);
  });

  it("treats a missing NODE_ENV as deployed, not as local", () => {
    expect(problems({ COOKIE_SECURE: "true" }).join("\n")).toContain("COOKIE_SECRET: is required");
    expect(problems({})).not.toEqual([]);
  });

  it("treats an unknown NODE_ENV (a typo) as deployed", () => {
    expect(problems({ NODE_ENV: "prod" }).join("\n")).toContain("COOKIE_SECRET: is required");
    expect(problems({ NODE_ENV: "staging" }).join("\n")).toContain("COOKIE_SECRET: is required");
  });

  it("never carries the secret into the problem it reports", () => {
    const secret = "short-secret-value-9876";
    const report = problems(deployed({ COOKIE_SECRET: secret })).join("\n");
    expect(report).not.toContain(secret);
  });
});

describe("the rest of the cookie when deployed", () => {
  it("must be Secure", () => {
    expect(problems(deployed({ COOKIE_SECURE: "false" })).join("\n")).toContain("COOKIE_SECURE");
    expect(problems(deployed({ COOKIE_SECURE: undefined })).join("\n")).toContain("COOKIE_SECURE");
  });

  it("must be host-only: no Domain", () => {
    expect(problems(deployed({ COOKIE_DOMAIN: "thesomnus.com" })).join("\n")).toContain(
      "COOKIE_DOMAIN",
    );
  });

  it("must not be SameSite=None", () => {
    expect(problems(deployed({ COOKIE_SAMESITE: "none" })).join("\n")).toContain("COOKIE_SAMESITE");
    expect(problems(deployed({ COOKIE_SAMESITE: "strict" }))).toEqual([]);
    expect(problems(deployed({ COOKIE_SAMESITE: "lax" }))).toEqual([]);
  });
});

describe("local development keeps working with no .env file", () => {
  it.each(["development", "test"])("%s: no secret falls back to the development default", (env) => {
    const parsed = EdgeConfigSchema.parse({ NODE_ENV: env });
    expect(parsed.COOKIE_SECRET).toBe(DEVELOPMENT_COOKIE_SECRET);
    expect(parsed.COOKIE_SECRETS).toEqual([DEVELOPMENT_COOKIE_SECRET]);
    expect(parsed.COOKIE_SECURE).toBe(false);
  });

  it("still refuses an absurdly short secret", () => {
    expect(problems({ NODE_ENV: "development", COOKIE_SECRET: "abc" }).join("\n")).toContain(
      "at least 16",
    );
  });
});

describe("secret rotation", () => {
  it("verifies with the current secret first and the retired one second", () => {
    const current = strong();
    const previous = strong();
    const parsed = EdgeConfigSchema.parse(
      deployed({ COOKIE_SECRET: current, COOKIE_SECRET_PREVIOUS: previous }),
    );
    expect(parsed.COOKIE_SECRET).toBe(current);
    expect(parsed.COOKIE_SECRETS).toEqual([current, previous]);
  });

  it("without a retired secret, only the current one verifies", () => {
    const current = strong();
    expect(EdgeConfigSchema.parse(deployed({ COOKIE_SECRET: current })).COOKIE_SECRETS).toEqual([
      current,
    ]);
  });

  it("holds the retired secret to the same standard", () => {
    expect(problems(deployed({ COOKIE_SECRET_PREVIOUS: "k".repeat(31) })).join("\n")).toContain(
      "COOKIE_SECRET_PREVIOUS: is shorter than 32 bytes",
    );
    expect(
      problems(deployed({ COOKIE_SECRET_PREVIOUS: DEVELOPMENT_COOKIE_SECRET })).join("\n"),
    ).toContain("COOKIE_SECRET_PREVIOUS: is a development default");
  });

  it("refuses a retired secret equal to the current one", () => {
    const same = strong();
    expect(
      problems(deployed({ COOKIE_SECRET: same, COOKIE_SECRET_PREVIOUS: same })).join("\n"),
    ).toContain("must differ");
  });
});

describe("cookieSecretProblem", () => {
  it("is null for a strong secret and never echoes a weak one", () => {
    expect(cookieSecretProblem(strong())).toBeNull();
    expect(cookieSecretProblem("weak-value")).not.toContain("weak-value");
  });
});

describe("loadEdgeConfig at startup", () => {
  afterEach(() => vi.restoreAllMocks());

  function start(env: Record<string, string | undefined>) {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let outcome: "started" | "exited" = "started";
    try {
      loadEdgeConfig(env as NodeJS.ProcessEnv);
    } catch {
      outcome = "exited";
    }
    return { outcome, exitCode: exit.mock.calls[0]?.[0], output: log.mock.calls.flat().join("\n") };
  }

  it("exits with a non-zero code and does not start", () => {
    const { outcome, exitCode } = start({ NODE_ENV: "production" });
    expect(outcome).toBe("exited");
    expect(exitCode).toBe(1);
  });

  it("names the setting but never prints the secret", () => {
    const secret = "weak-secret-do-not-print";
    const { outcome, output } = start(deployed({ COOKIE_SECRET: secret }));
    expect(outcome).toBe("exited");
    expect(output).toContain("COOKIE_SECRET");
    expect(output).not.toContain(secret);
  });

  it("starts with a strong secret", () => {
    expect(start(deployed()).outcome).toBe("started");
  });
});
