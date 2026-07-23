import "reflect-metadata";
import { createLogger, REDACTED } from "@somnus/observability";
import { captureLogger } from "@somnus/test-utils";
import { describe, expect, it } from "vitest";
import { SomnusLogger } from "../src/infrastructure/logger/somnus.logger.js";

const service = { name: "somnus-identity-service", env: "test", version: "0.0.0", commit: "test" };

describe("SomnusLogger + correlation + redaction (build plan §19)", () => {
  it("routes Nest's logger calls through @somnus/observability with redaction", () => {
    const sink = captureLogger();
    const logger = createLogger({ service, correlationId: "test", write: sink, level: "debug" });
    SomnusLogger.replaceGlobalLogger(logger);
    const adapter = new SomnusLogger();
    adapter.log("user signed in", "AuthService");
    adapter.warn("credentials check", { token: "leaky-token-xyz", userId: "u1" });
    adapter.error("oops", "Error: at Module.<anonymous>\n  at file.js:1:1", "AuthService");
    adapter.debug("debug line", "AuthService");
    adapter.verbose("verbose line", "AuthService");
    expect(sink.lines.length).toBe(5);
    const allText = sink.lines.map((l) => l.raw).join("\n");
    expect(allText).not.toContain("leaky-token-xyz");
    expect(allText).not.toContain("at file.js:1:1");
    const warn = sink.lines.find((l) => (l.parsed?.["level"] as string) === "warn");
    expect(warn?.parsed?.["data"]).toMatchObject({ userId: "u1", token: REDACTED });
    const error = sink.lines.find((l) => (l.parsed?.["level"] as string) === "error");
    expect(error?.parsed?.["data"]).toMatchObject({ hasTrace: true });
    expect(error?.parsed?.["data"]).not.toHaveProperty("stack");
  });
});
