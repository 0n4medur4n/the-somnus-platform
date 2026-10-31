import { describe, expect, it } from "vitest";
import { usesDevMock } from "./nox-me-mode.js";

describe("usesDevMock", () => {
  it("is on only for the Vite development server and the test runner", () => {
    expect(usesDevMock("development")).toBe(true);
    expect(usesDevMock("test")).toBe(true);
  });

  it("is off for every other mode, including an unset one", () => {
    expect(usesDevMock("production")).toBe(false);
    expect(usesDevMock("staging")).toBe(false);
    expect(usesDevMock("dev")).toBe(false);
    expect(usesDevMock("")).toBe(false);
    expect(usesDevMock(undefined)).toBe(false);
  });
});
