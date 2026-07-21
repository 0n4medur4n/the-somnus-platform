import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineConfig, definePublicField } from "./define.js";

describe("definePublicField", () => {
  it("freezes the definition", () => {
    const f = definePublicField("FOO", z.string(), "foo description");
    expect(Object.isFrozen(f)).toBe(true);
    expect(f.key).toBe("FOO");
    expect(f.description).toBe("foo description");
  });
});

describe("defineConfig", () => {
  it("builds a Zod object schema from a list of fields", () => {
    const { schema, keys } = defineConfig([
      definePublicField("A", z.string(), ""),
      definePublicField("B", z.coerce.number(), ""),
    ]);
    const r = schema.safeParse({ A: "x", B: "42" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.B).toBe(42);
    }
    expect(keys).toEqual(["A", "B"]);
  });
});
