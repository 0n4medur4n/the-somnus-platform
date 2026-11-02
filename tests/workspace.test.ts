import { describe, expect, it } from "vitest";

describe("workspace quality gate (Phase 1.1 / Checkpoint 1.1)", () => {
  it("runs a trivial assertion to prove Vitest wiring", () => {
    expect(1 + 1).toBe(2);
  });

  it("sees the repository root on disk (the build plan itself lives in the private internal repo)", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const readmePath = path.join(process.cwd(), "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);
  });
});
