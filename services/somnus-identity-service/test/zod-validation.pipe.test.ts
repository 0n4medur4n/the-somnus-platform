import "reflect-metadata";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ZodValidationPipe } from "../src/common/pipes/zod-validation.pipe.js";

const schema = z.object({
  name: z.string().min(1),
  age: z.coerce.number().int().min(0).max(120),
});

describe("ZodValidationPipe", () => {
  it("returns the parsed value on success", () => {
    const pipe = new ZodValidationPipe(schema);
    const out = pipe.transform({ name: "Ana", age: "30" }, { type: "body" });
    expect(out).toEqual({ name: "Ana", age: 30 });
  });

  it("throws a SomnusError(VALIDATION_FAILED) with the Zod issues in details on failure", () => {
    const pipe = new ZodValidationPipe(schema);
    try {
      pipe.transform({ name: "", age: "not-a-number" }, { type: "body" });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SomnusError);
      if (err instanceof SomnusError) {
        expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
        const details = err.details as Record<string, string>;
        expect(details["name"]).toBeDefined();
        expect(details["age"]).toBeDefined();
      }
    }
  });
});
