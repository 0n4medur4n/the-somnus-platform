import { describe, expect, it } from "vitest";
import { z } from "zod";
import mainSource from "../main.tsx?raw";
import "./zod-config.js";

/**
 * Guards the app's CSP: the production policy has no `unsafe-eval`, so Zod must
 * not try to compile schemas with `new Function`. The runtime effect is caught
 * by the Playwright suite, which fails on any securitypolicyviolation.
 */
describe("zod-config", () => {
  it("turns Zod's JIT compiler off", () => {
    expect(z.config().jitless).toBe(true);
  });

  it("is the first import of main.tsx, before anything parses a schema", () => {
    const firstImport = mainSource
      .split(/\r?\n/)
      .find((line: string) => line.startsWith("import "));
    expect(firstImport).toBe('import "./lib/zod-config.js";');
  });
});
