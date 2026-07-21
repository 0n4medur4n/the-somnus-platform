import { describe, expect, it } from "vitest";

describe("workspace quality gate (Phase 1.1 / Checkpoint 1.1)", () => {
  it("runs a trivial assertion to prove Vitest wiring", () => {
    expect(1 + 1).toBe(2);
  });

  it("loads the build plan to confirm it is present on disk", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const planPath = path.join(process.cwd(), "THE_SOMNUS_PLATFORM_BUILD_PLAN.md");
    expect(fs.existsSync(planPath)).toBe(true);
  });
});
