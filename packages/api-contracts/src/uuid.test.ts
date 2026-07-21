import { describe, expect, it } from "vitest";
import { isUUIDv7, opaqueId, parseOpaqueId, UUIDv7 } from "./uuid.js";

describe("UUIDv7", () => {
  it("generates a UUIDv7", () => {
    const id = UUIDv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(isUUIDv7(id)).toBe(true);
  });

  it("generates time-ordered ids (later call > earlier call lexically)", async () => {
    const a = UUIDv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = UUIDv7();
    expect(a < b).toBe(true);
  });

  it("rejects a non-UUIDv7 string in parseOpaqueId", () => {
    expect(() => parseOpaqueId("not-a-uuid")).toThrow();
    // The nil UUID is structurally valid but not v7
    expect(() => parseOpaqueId("00000000-0000-0000-0000-000000000000")).toThrow();
    // v4 is structurally valid UUID but not v7
    expect(() => parseOpaqueId("123e4567-e89b-12d3-a456-426614174000")).toThrow();
  });

  it("rejects non-string input", () => {
    expect(isUUIDv7(42)).toBe(false);
    expect(isUUIDv7(null)).toBe(false);
    expect(isUUIDv7(undefined)).toBe(false);
  });

  it("opaqueId is the same function as UUIDv7", () => {
    expect(opaqueId).toBe(UUIDv7);
  });
});
