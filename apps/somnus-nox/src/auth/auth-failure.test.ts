import { describe, expect, it } from "vitest";
import { classifyCallbackFailure } from "./auth-failure.js";

describe("classifyCallbackFailure", () => {
  it("treats an expired or invalid action code as a bad link", () => {
    expect(classifyCallbackFailure({ code: "auth/expired-action-code" })).toBe("link-invalid");
    expect(classifyCallbackFailure({ code: "auth/invalid-action-code" })).toBe("link-invalid");
  });

  it("does not invent a cause for anything else", () => {
    expect(classifyCallbackFailure({ code: "auth/invalid-email" })).toBe("generic");
    expect(classifyCallbackFailure(new Error("down"))).toBe("generic");
    expect(classifyCallbackFailure(null)).toBe("generic");
    expect(classifyCallbackFailure({ code: 500 })).toBe("generic");
  });
});
