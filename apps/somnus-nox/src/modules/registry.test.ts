import { describe, expect, it } from "vitest";
import { NOX_MODULES } from "./registry.js";

describe("module registry", () => {
  it("lists the assistant and the evidence search, and nothing else yet", () => {
    expect(NOX_MODULES.map((module) => module.id)).toEqual(["assistant", "evidence-search"]);
  });
});
