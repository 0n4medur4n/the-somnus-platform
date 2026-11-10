import { describe, expect, it } from "vitest";
import { evaluateSignCount } from "../../src/domain/passkey/passkey.js";

describe("evaluateSignCount (ADR 0027 decision 7)", () => {
  it("treats an increase as ok", () => {
    expect(evaluateSignCount(0, 1)).toBe("ok");
    expect(evaluateSignCount(4, 5)).toBe("ok");
  });

  it("treats an equal non-zero count as a regression", () => {
    expect(evaluateSignCount(3, 3)).toBe("regression");
  });

  it("treats a lower non-zero count as a regression", () => {
    expect(evaluateSignCount(4, 1)).toBe("regression");
  });

  it("treats zero to zero as ok", () => {
    expect(evaluateSignCount(0, 0)).toBe("ok");
  });

  it("treats a received count of zero as ok even when the stored count is not", () => {
    expect(evaluateSignCount(4, 0)).toBe("ok");
  });
});
