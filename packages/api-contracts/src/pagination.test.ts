import { describe, expect, it } from "vitest";
import {
  buildPaginatedResponse,
  CursorSchema,
  PageInfoSchema,
  PaginationQuerySchema,
} from "./pagination.js";

describe("PaginationQuerySchema", () => {
  it("coerces limit from a string and applies the default", () => {
    const r = PaginationQuerySchema.safeParse({ limit: "50" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(50);
  });

  it("uses the default limit when limit is missing", () => {
    const r = PaginationQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(20);
  });

  it("rejects limit > 100", () => {
    const r = PaginationQuerySchema.safeParse({ limit: 101 });
    expect(r.success).toBe(false);
  });

  it("rejects limit < 1", () => {
    const r = PaginationQuerySchema.safeParse({ limit: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict mode)", () => {
    const r = PaginationQuerySchema.safeParse({ limit: 10, evil: "yes" });
    expect(r.success).toBe(false);
  });

  it("rejects an empty cursor", () => {
    const r = PaginationQuerySchema.safeParse({ cursor: "" });
    expect(r.success).toBe(false);
  });
});

describe("PageInfoSchema", () => {
  it("accepts the shape", () => {
    const r = PageInfoSchema.safeParse({ limit: 5, cursor: "abc" });
    expect(r.success).toBe(true);
  });
});

describe("CursorSchema", () => {
  it("defaults op to after", () => {
    const r = CursorSchema.parse({ value: "c" });
    expect(r.op).toBe("after");
  });
  it("accepts before explicitly", () => {
    const r = CursorSchema.parse({ value: "c", op: "before" });
    expect(r.op).toBe("before");
  });
});

describe("buildPaginatedResponse", () => {
  it("includes nextCursor and total only when provided", () => {
    const r1 = buildPaginatedResponse([{ id: "a" }]);
    expect(r1.meta).toEqual({});
    const r2 = buildPaginatedResponse([{ id: "a" }], "next");
    expect(r2.meta).toEqual({ nextCursor: "next" });
    const r3 = buildPaginatedResponse([{ id: "a" }], undefined, 7);
    expect(r3.meta).toEqual({ total: 7 });
  });
});
