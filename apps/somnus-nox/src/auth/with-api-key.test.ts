import { describe, expect, it } from "vitest";
import { withApiKey } from "./firebase-auth.js";

describe("withApiKey", () => {
  it("adds the public web api key only when the emailed link has none", () => {
    const withCode = withApiKey("https://nox.thesomnus.com/auth/callback?oobCode=abc");
    expect(withCode).toContain("apiKey=demo-api-key");
    expect(withApiKey("not a url")).toBe("not a url");
    expect(withApiKey("https://nox.thesomnus.com/auth/callback?oobCode=abc&apiKey=keep")).toContain(
      "apiKey=keep",
    );
  });
});
