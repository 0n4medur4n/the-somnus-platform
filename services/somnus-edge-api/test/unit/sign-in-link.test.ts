import { describe, expect, it } from "vitest";
import { cleanSignInLink, throttleKey } from "../../src/modules/auth-email-link/sign-in-link.js";

const CALLBACK = "https://app.thesomnus.com/auth/callback";

describe("cleanSignInLink", () => {
  it("keeps only the one-time code, pointed straight at our callback", () => {
    const generated =
      "https://the-somnus-30c48.firebaseapp.com/__/auth/action?apiKey=AIzaKEY&mode=signIn&oobCode=CODE-123&continueUrl=https%3A%2F%2Fapp.thesomnus.com%2Fauth%2Fcallback&lang=en";
    expect(cleanSignInLink(generated, CALLBACK, "es")).toBe(
      "https://app.thesomnus.com/auth/callback?mode=signIn&oobCode=CODE-123&lng=es",
    );
  });

  it("works with the emulator's link format too", () => {
    const generated =
      "http://127.0.0.1:9099/emulator/action?mode=signIn&lang=en&oobCode=EMU&apiKey=fake-api-key&continueUrl=x";
    expect(cleanSignInLink(generated, "http://localhost:5173/auth/callback", "fr")).toBe(
      "http://localhost:5173/auth/callback?mode=signIn&oobCode=EMU&lng=fr",
    );
  });

  it("refuses a link with no code rather than emailing a dead one", () => {
    expect(() => cleanSignInLink("https://x.example/action?mode=signIn", CALLBACK, "es")).toThrow();
  });
});

describe("throttleKey", () => {
  it("is a hash: the address itself is never stored", () => {
    const key = throttleKey("ada@example.com");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("ada");
    expect(throttleKey("ada@example.com")).toBe(key);
  });
});
