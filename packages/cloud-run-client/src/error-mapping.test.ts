import { describe, expect, it } from "vitest";
import { mapHttpErrorToSomnusError } from "./error-mapping.js";

describe("mapHttpErrorToSomnusError", () => {
  it("prefers the upstream §16 error code when present", () => {
    const e = mapHttpErrorToSomnusError(
      401,
      {
        error: { code: "UNAUTHENTICATED", message: "no token", correlationId: "c1", details: {} },
      },
      { correlationId: "c1", fallbackMessage: "fallback", url: "https://x" },
    );
    expect(e.code).toBe("UNAUTHENTICATED");
    expect(e.correlationId).toBe("c1");
    expect(e.details["upstreamStatus"]).toBe(401);
    expect(e.details["upstreamCode"]).toBe("UNAUTHENTICATED");
  });

  it("falls back to a status-based code when body is not §16-shaped", () => {
    const e = mapHttpErrorToSomnusError(
      404,
      { not: "an error" },
      {
        correlationId: "c2",
        fallbackMessage: "missing",
        url: "https://x",
      },
    );
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("missing");
  });

  it("falls back to UPSTREAM_UNAVAILABLE on 502/503/504", () => {
    for (const status of [502, 503, 504]) {
      const e = mapHttpErrorToSomnusError(status, null, {
        correlationId: "c",
        fallbackMessage: "up",
        url: "u",
      });
      expect(e.code).toBe("UPSTREAM_UNAVAILABLE");
    }
  });

  it("ignores an unknown upstream code and uses the status mapping", () => {
    const e = mapHttpErrorToSomnusError(
      403,
      { error: { code: "MAGIC_CUSTOM_THING", message: "x", correlationId: "c", details: {} } },
      { correlationId: "c", fallbackMessage: "f", url: "u" },
    );
    expect(e.code).toBe("FORBIDDEN");
  });

  it("falls back to INTERNAL for 500", () => {
    const e = mapHttpErrorToSomnusError(500, null, {
      correlationId: "c",
      fallbackMessage: "f",
      url: "u",
    });
    expect(e.code).toBe("INTERNAL");
  });
});
