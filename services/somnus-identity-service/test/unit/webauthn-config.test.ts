import { describe, expect, it } from "vitest";
import {
  loadWebAuthnConfig,
  PRODUCTION_WEBAUTHN_ORIGIN,
  PRODUCTION_WEBAUTHN_RP_ID,
  WebAuthnConfigError,
} from "../../src/modules/passkeys/webauthn.config.js";

const PRODUCTION = {
  NODE_ENV: "production",
  WEBAUTHN_RP_ID: PRODUCTION_WEBAUTHN_RP_ID,
  WEBAUTHN_ORIGIN: PRODUCTION_WEBAUTHN_ORIGIN,
};

describe("loadWebAuthnConfig", () => {
  it("accepts the single production origin and rpId", () => {
    const config = loadWebAuthnConfig(PRODUCTION);
    expect(config.origin).toBe(PRODUCTION_WEBAUTHN_ORIGIN);
    expect(config.rpId).toBe(PRODUCTION_WEBAUTHN_RP_ID);
    expect(config.challengeTtlSeconds).toBe(300);
    expect(config.pendingTtlSeconds).toBe(24 * 60 * 60);
    expect(config.maxPendingCredentials).toBe(3);
    expect(config.rpName).toBe("The Somnus");
  });

  it("refuses 127.0.0.1 because an address cannot be a relying party id", () => {
    expect(() =>
      loadWebAuthnConfig({
        NODE_ENV: "development",
        WEBAUTHN_RP_ID: "localhost",
        WEBAUTHN_ORIGIN: "http://127.0.0.1:5174",
      }),
    ).toThrow(WebAuthnConfigError);
    expect(() =>
      loadWebAuthnConfig({
        NODE_ENV: "test",
        WEBAUTHN_RP_ID: "127.0.0.1",
        WEBAUTHN_ORIGIN: "http://localhost:5174",
      }),
    ).toThrow(WebAuthnConfigError);
  });

  it("accepts one localhost origin only in development and test", () => {
    for (const nodeEnv of ["development", "test"]) {
      const config = loadWebAuthnConfig({
        NODE_ENV: nodeEnv,
        WEBAUTHN_RP_ID: "localhost",
        WEBAUTHN_ORIGIN: "http://localhost:5174",
      });
      expect(config.origin).toBe("http://localhost:5174");
      expect(config.rpId).toBe("localhost");
    }
  });

  it("refuses to operate when the variables are missing", () => {
    expect(() => loadWebAuthnConfig({ NODE_ENV: "production" })).toThrow(WebAuthnConfigError);
    expect(() => loadWebAuthnConfig({ NODE_ENV: "test", WEBAUTHN_RP_ID: "localhost" })).toThrow(
      WebAuthnConfigError,
    );
  });

  it.each([
    ["http://localhost:5174", "localhost"],
    ["http://console.thesomnus.com", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://console.thesomnus.com:443", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://console.thesomnus.com.", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://console.thesomnus.com/admin", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://console.thesomnus.com.example", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://example.com/console.thesomnus.com", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://Console.thesomnus.com", PRODUCTION_WEBAUTHN_RP_ID],
    ["https://*.thesomnus.com", PRODUCTION_WEBAUTHN_RP_ID],
  ])("production refuses origin %s", (origin, rpId) => {
    expect(() =>
      loadWebAuthnConfig({ NODE_ENV: "production", WEBAUTHN_ORIGIN: origin, WEBAUTHN_RP_ID: rpId }),
    ).toThrow(WebAuthnConfigError);
  });

  it("production refuses a list and a wildcard rpId", () => {
    expect(() =>
      loadWebAuthnConfig({
        NODE_ENV: "production",
        WEBAUTHN_ORIGIN: `${PRODUCTION_WEBAUTHN_ORIGIN},http://localhost:5174`,
        WEBAUTHN_RP_ID: PRODUCTION_WEBAUTHN_RP_ID,
      }),
    ).toThrow(WebAuthnConfigError);
    expect(() =>
      loadWebAuthnConfig({
        NODE_ENV: "production",
        WEBAUTHN_ORIGIN: PRODUCTION_WEBAUTHN_ORIGIN,
        WEBAUTHN_RP_ID: "*.thesomnus.com",
      }),
    ).toThrow(WebAuthnConfigError);
  });

  it("treats staging and an unset environment as production", () => {
    expect(() =>
      loadWebAuthnConfig({
        NODE_ENV: "staging",
        WEBAUTHN_ORIGIN: "http://localhost:5174",
        WEBAUTHN_RP_ID: "localhost",
      }),
    ).toThrow(WebAuthnConfigError);
    expect(() =>
      loadWebAuthnConfig({
        WEBAUTHN_ORIGIN: "http://localhost",
        WEBAUTHN_RP_ID: "localhost",
      }),
    ).toThrow(WebAuthnConfigError);
  });

  it("refuses a duration other than the ADR value", () => {
    expect(() =>
      loadWebAuthnConfig({ ...PRODUCTION, WEBAUTHN_CHALLENGE_TTL_SECONDS: "301" }),
    ).toThrow(WebAuthnConfigError);
    expect(() => loadWebAuthnConfig({ ...PRODUCTION, WEBAUTHN_PENDING_TTL_SECONDS: "10" })).toThrow(
      WebAuthnConfigError,
    );
    expect(() =>
      loadWebAuthnConfig({ ...PRODUCTION, WEBAUTHN_MAX_PENDING_CREDENTIALS: "4" }),
    ).toThrow(WebAuthnConfigError);
  });

  it("development still refuses a list", () => {
    expect(() =>
      loadWebAuthnConfig({
        NODE_ENV: "development",
        WEBAUTHN_ORIGIN: "http://localhost:5174,http://localhost:4174",
        WEBAUTHN_RP_ID: "localhost",
      }),
    ).toThrow(WebAuthnConfigError);
  });
});
