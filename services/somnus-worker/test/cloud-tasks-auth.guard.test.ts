import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CloudTasksAuthGuard } from "../src/modules/notification/cloud-tasks-auth.guard.js";

function contextWithAuth(header: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: header } }) }),
  } as unknown as ExecutionContext;
}

const original = process.env["CLOUD_TASKS_AUTH_TOKEN"];

afterEach(() => {
  if (original === undefined) delete process.env["CLOUD_TASKS_AUTH_TOKEN"];
  else process.env["CLOUD_TASKS_AUTH_TOKEN"] = original;
});

describe("CloudTasksAuthGuard", () => {
  it("allows any request when no token is configured (local dev)", () => {
    delete process.env["CLOUD_TASKS_AUTH_TOKEN"];
    expect(new CloudTasksAuthGuard().canActivate(contextWithAuth(undefined))).toBe(true);
  });

  describe("with a token configured", () => {
    beforeEach(() => {
      process.env["CLOUD_TASKS_AUTH_TOKEN"] = "expected-token";
    });

    it("allows a matching bearer token", () => {
      expect(new CloudTasksAuthGuard().canActivate(contextWithAuth("Bearer expected-token"))).toBe(
        true,
      );
    });

    it("rejects a missing or wrong token", () => {
      const guard = new CloudTasksAuthGuard();
      expect(() => guard.canActivate(contextWithAuth(undefined))).toThrow(UnauthorizedException);
      expect(() => guard.canActivate(contextWithAuth("Bearer nope"))).toThrow(
        UnauthorizedException,
      );
    });
  });
});
