import { describe, expect, it } from "vitest";
import { PRODUCTION_CONSOLE_ORIGIN } from "../../src/config/edge-config.js";
import {
  classifySessionClient,
  presentedOrigin,
} from "../../src/modules/sessions/classify-session.js";

/**
 * Negative cases first. Console is one string: the configured origin, nothing
 * else. These stay app even if a later check also looks at Sec-Fetch-Site.
 */
const CONSOLE = PRODUCTION_CONSOLE_ORIGIN;

const NOT_CONSOLE: Array<string | null | undefined> = [
  "https://console.thesomnus.com.example",
  "https://example.com/console.thesomnus.com",
  "http://console.thesomnus.com",
  "https://console.thesomnus.com:443",
  "https://console.thesomnus.com.",
  "https://Console.thesomnus.com",
  "https://CONSOLE.THESOMNUS.COM",
  " https://console.thesomnus.com",
  "https://console.thesomnus.com ",
  "https://console.thesomnus.com/",
  "https://console.thesomnus.com/auth/callback",
  "null",
  null,
  undefined,
  "https://app.thesomnus.com",
  "http://localhost:5174",
];

describe("classifySessionClient", () => {
  it("classifies origin tricks, null, an absent origin and the app origin as app", () => {
    const accepted = NOT_CONSOLE.filter(
      (origin) => classifySessionClient(origin, CONSOLE) !== "app",
    );
    expect(accepted).toEqual([]);
  });

  it("classifies the exact console origin as console", () => {
    expect(classifySessionClient(CONSOLE, CONSOLE)).toBe("console");
  });

  it("does not fold case or trim the configured origin either", () => {
    expect(classifySessionClient(CONSOLE, "https://Console.thesomnus.com")).toBe("app");
    expect(classifySessionClient(CONSOLE, ` ${CONSOLE}`)).toBe("app");
    expect(classifySessionClient("http://localhost:5174", "http://localhost:5174")).toBe("console");
  });
});

describe("presentedOrigin", () => {
  it("keeps one string, including the opaque null token and surrounding space", () => {
    expect(presentedOrigin(CONSOLE)).toBe(CONSOLE);
    expect(presentedOrigin("null")).toBe("null");
    expect(presentedOrigin(` ${CONSOLE} `)).toBe(` ${CONSOLE} `);
  });

  it("turns null, an absent header and more than one value into something other than the console origin", () => {
    expect(presentedOrigin(undefined)).toBeUndefined();
    expect(presentedOrigin(null)).toBeNull();
    expect(presentedOrigin([CONSOLE])).toBeNull();
    expect(presentedOrigin([CONSOLE, "https://evil.example"])).toBeNull();
    expect(classifySessionClient(presentedOrigin(null), CONSOLE)).toBe("app");
    expect(classifySessionClient(presentedOrigin(undefined), CONSOLE)).toBe("app");
    expect(classifySessionClient(presentedOrigin([CONSOLE]), CONSOLE)).toBe("app");
  });
});
