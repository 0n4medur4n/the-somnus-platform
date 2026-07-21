import { describe, expect, it } from "vitest";
import { getTracer, noopTracer } from "./tracing.js";

describe("noopTracer", () => {
  it("returns a no-op span whose methods do nothing", () => {
    const t = noopTracer();
    let ran = false;
    const result = t.startSpan("test", (span) => {
      expect(span).toBeDefined();
      span.setAttribute("k", "v");
      span.setAttribute("n", 1);
      span.setAttribute("b", true);
      span.recordException(new Error("ignored"));
      span.end();
      ran = true;
      return "ok";
    });
    expect(ran).toBe(true);
    expect(result).toBe("ok");
  });
});
describe("getTracer", () => {
  it("returns a tracer whose span is callable (no SDK registered => no-op)", () => {
    const t = getTracer("somnus-test");
    const result = t.startSpan("op", (span) => {
      span.setAttribute("a", 1);
      span.end();
      return 42;
    });
    expect(result).toBe(42);
  });
  it("returns a tracer for the default name", () => {
    const t = getTracer();
    const result = t.startSpan("op", (span) => {
      span.end();
      return null;
    });
    expect(result).toBeNull();
  });
});
//# sourceMappingURL=tracing.test.js.map
