import { type ArgumentsHost, ForbiddenException, HttpException } from "@nestjs/common";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import {
  markCsrfCheckPassed,
  markCsrfCheckPending,
  wasRejectedByCsrf,
} from "../../src/bootstrap/csrf-state.js";
import { SomnusExceptionFilter } from "../../src/common/filters/somnus-exception.filter.js";

/**
 * Only a request the CSRF gate turned away may carry `details.reason: "csrf"`.
 *
 * The SPA refreshes its token and retries once on exactly that marker. Putting
 * it on a 403 that means "not allowed" would make the client re-send a
 * forbidden mutation; leaving it off a real CSRF rejection would leave a user
 * with a stale token unable to do anything until they signed in again.
 */

type Sent = { status: number; body: { error: { code: string; details: Record<string, unknown> } } };

function run(exception: unknown, request: object): Sent {
  let sent: Sent | undefined;
  const reply = {
    status: (status: number) => ({
      send: (body: Sent["body"]) => {
        sent = { status, body };
      },
    }),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
      getNext: () => undefined,
    }),
  } as unknown as ArgumentsHost;
  new SomnusExceptionFilter().catch(exception, host);
  if (!sent) throw new Error("the filter sent nothing");
  return sent;
}

/** What Nest hands the filter for a CSRF rejection: the plugin's code is gone. */
const nestWrappedCsrf = () => new HttpException("Invalid csrf token", 403);

describe("csrf-state", () => {
  it("is pending until the gate reports a pass", () => {
    const request = {};
    expect(wasRejectedByCsrf(request)).toBe(false);
    markCsrfCheckPending(request);
    expect(wasRejectedByCsrf(request)).toBe(true);
    markCsrfCheckPassed(request);
    expect(wasRejectedByCsrf(request)).toBe(false);
  });
});

describe("the exception filter names CSRF rejections, and only those", () => {
  it("marks a 403 for a request the gate stopped", () => {
    const request = {};
    markCsrfCheckPending(request);
    const sent = run(nestWrappedCsrf(), request);
    expect(sent.status).toBe(403);
    expect(sent.body.error.code).toBe("FORBIDDEN");
    expect(sent.body.error.details).toEqual({ reason: "csrf" });
  });

  it("also marks the plugin's raw error if it ever arrives unwrapped", () => {
    const request = {};
    markCsrfCheckPending(request);
    const raw = Object.assign(new Error("Missing csrf secret"), {
      code: "FST_CSRF_MISSING_SECRET",
      statusCode: 403,
    });
    expect(run(raw, request).body.error.details).toEqual({ reason: "csrf" });
  });

  it("does not mark a 403 for a request that passed the check", () => {
    const request = {};
    markCsrfCheckPending(request);
    markCsrfCheckPassed(request);
    expect(run(new ForbiddenException(), request).body.error.details).toEqual({});
  });

  it("does not mark a 403 for a request that never went through the check (a GET)", () => {
    expect(run(nestWrappedCsrf(), {}).body.error.details).toEqual({});
  });

  it("does not mark an authorization FORBIDDEN, even on a request still marked pending", () => {
    // A SomnusError is the application saying "not allowed"; its own details
    // are what the client sees, and a retry would be wrong.
    const request = {};
    markCsrfCheckPending(request);
    const forbidden = new SomnusError(ErrorCode.FORBIDDEN, "nope", {
      correlationId: "c",
      details: { reason: "capability" },
    });
    expect(run(forbidden, request).body.error.details).toEqual({ reason: "capability" });
  });

  it("does not mark a non-403 status", () => {
    const request = {};
    markCsrfCheckPending(request);
    expect(run(new HttpException("x", 401), request).body.error.details).toEqual({});
  });
});
