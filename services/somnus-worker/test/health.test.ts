import { describe, expect, it } from "vitest";
import { HealthController } from "../src/modules/health/health.controller.js";
import { VersionController } from "../src/modules/version/version.controller.js";

describe("HealthController", () => {
  it("live reports ok", () => {
    expect(new HealthController().live()).toEqual({ status: "ok" });
  });

  it("ready reports ready", () => {
    expect(new HealthController().ready()).toEqual({ status: "ready" });
  });
});

describe("VersionController", () => {
  it("reports the worker build info", () => {
    const info = new VersionController().version();
    expect(info.service).toBe("somnus-worker");
    expect(info.node).toBe(process.versions.node);
    expect(info.version).toBeTypeOf("string");
  });
});
