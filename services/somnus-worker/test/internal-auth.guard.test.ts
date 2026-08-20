import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { InternalAuthGuard } from "../src/common/guards/internal-auth.guard.js";

function contextWithAuth(header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: header } }) }),
  } as unknown as ExecutionContext;
}

const original = process.env["INTERNAL_AUTH_TOKEN"];

afterEach(() => {
  if (original === undefined) delete process.env["INTERNAL_AUTH_TOKEN"];
  else process.env["INTERNAL_AUTH_TOKEN"] = original;
});

describe("InternalAuthGuard", () => {
  it("allows any request when no token is configured (local dev)", () => {
    delete process.env["INTERNAL_AUTH_TOKEN"];
    expect(new InternalAuthGuard().canActivate(contextWithAuth(undefined))).toBe(true);
  });

  it("allows a matching bearer token and rejects a wrong one", () => {
    process.env["INTERNAL_AUTH_TOKEN"] = "expected";
    expect(new InternalAuthGuard().canActivate(contextWithAuth("Bearer expected"))).toBe(true);
    expect(() => new InternalAuthGuard().canActivate(contextWithAuth("Bearer nope"))).toThrow(
      UnauthorizedException,
    );
  });
});
