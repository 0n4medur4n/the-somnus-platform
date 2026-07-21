import { describe, expect, it } from "vitest";
import { correlationIdMiddleware, generateCorrelationId } from "./correlation.js";

describe("correlationIdMiddleware", () => {
  it("generates a correlation id when none is provided", () => {
    const setHeader = () => {};
    const req = { headers: {} };
    const res = { setHeader };
    let nextCalled = false;
    const id = correlationIdMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(nextCalled).toBe(true);
    expect(req.correlationId).toBe(id);
  });
  it("reuses a valid x-correlation-id from the request", () => {
    let captured = "";
    const req = {
      headers: { "x-correlation-id": "client-supplied-1" },
    };
    const res = {
      setHeader: (_k, v) => {
        captured = v;
      },
    };
    const id = correlationIdMiddleware(req, res, () => {});
    expect(id).toBe("client-supplied-1");
    expect(captured).toBe("client-supplied-1");
  });
  it("rejects an invalid x-correlation-id and falls back to a new one", () => {
    const req = {
      headers: { "x-correlation-id": "x".repeat(200) },
    };
    const res = { setHeader: () => {} };
    const id = correlationIdMiddleware(req, res, () => {});
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(id).not.toBe("x".repeat(200));
  });
  it("generateCorrelationId returns 16 url-safe chars", () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});
//# sourceMappingURL=correlation.test.js.map
