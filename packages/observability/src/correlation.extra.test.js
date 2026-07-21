import { describe, expect, it } from "vitest";
import { correlationIdMiddleware, withCorrelationId } from "./correlation.js";

describe("withCorrelationId", () => {
  it("calls the function and returns its result", () => {
    const result = withCorrelationId("c1", () => 42);
    expect(result).toBe(42);
  });
  it("falls back to x-request-id when x-correlation-id is absent", () => {
    const req = { headers: { "x-request-id": "req-1" } };
    let captured = "";
    const res = {
      setHeader: (_k, v) => {
        captured = v;
      },
    };
    const id = correlationIdMiddleware(req, res, () => {});
    expect(id).toBe("req-1");
    expect(captured).toBe("req-1");
  });
  it("writes x-correlation-id to res.headers when setHeader is not available", () => {
    const req = { headers: {} };
    const res = { headers: {} };
    correlationIdMiddleware(req, res, () => {});
    expect(res.headers["x-correlation-id"]).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
  it("accepts an array-shaped header value and uses the first entry", () => {
    const req = {
      headers: { "x-correlation-id": ["first", "second"] },
    };
    const res = { setHeader: () => {} };
    const id = correlationIdMiddleware(req, res, () => {});
    expect(id).toBe("first");
  });
});
//# sourceMappingURL=correlation.extra.test.js.map
