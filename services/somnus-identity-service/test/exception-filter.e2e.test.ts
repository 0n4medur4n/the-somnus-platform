import type { ArgumentsHost } from "@nestjs/common";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { describe, expect, it } from "vitest";
import { SomnusExceptionFilter } from "../src/common/filters/somnus-exception.filter.js";

type Sent = { status: number; body: unknown } | null;
type Reply = Parameters<SomnusExceptionFilter["catch"]>[0] extends never
  ? never
  : {
      status(code: number): { send(body: unknown): unknown };
    };

function makeHost() {
  const box: { sent: Sent } = { sent: null };
  const reply = {
    status(code: number) {
      return {
        send(body: unknown) {
          box.sent = { status: code, body };
          return reply;
        },
      };
    },
  } as unknown as Reply;
  function host(correlationId?: string): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ correlationId }),
        getResponse: () => reply,
        getNext: () => undefined,
      }),
    } as unknown as ArgumentsHost;
  }
  return { host, getSent: () => box.sent };
}

describe("SomnusExceptionFilter (unit)", () => {
  it("maps a SomnusError to the §16 shape with the upstream correlationId", () => {
    const filter = new SomnusExceptionFilter();
    const { host, getSent } = makeHost();
    const exc = new SomnusError(ErrorCode.NOT_FOUND, "thing not found", {
      correlationId: "boom-corr-1",
      details: { id: "abc" },
    });
    filter.catch(exc, host("boom-corr-1"));
    const sent = getSent();
    expect(sent).not.toBeNull();
    expect(sent?.status).toBe(404);
    const body = sent?.body as {
      error: { code: string; correlationId: string; details: Record<string, unknown> };
    };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.correlationId).toBe("boom-corr-1");
    expect(body.error.details).toEqual({ id: "abc" });
    expect(body.error.message).toBe("The requested resource was not found.");
  });

  it("maps an unhandled Error to INTERNAL with a generic message and no stack", () => {
    const filter = new SomnusExceptionFilter();
    const { host, getSent } = makeHost();
    const exc = new Error("plain error with secret token abc.def.ghi");
    filter.catch(exc, host("c2"));
    const sent = getSent();
    expect(sent?.status).toBe(500);
    const body = sent?.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("An internal error occurred.");
    expect(body.error).not.toHaveProperty("stack");
  });

  it("falls back to 'unknown' correlationId when the request has none", () => {
    const filter = new SomnusExceptionFilter();
    const { host, getSent } = makeHost();
    const exc = new SomnusError(ErrorCode.UNAUTHENTICATED, "no token", { correlationId: "x" });
    filter.catch(exc, host());
    const body = getSent()?.body as { error: { correlationId: string } };
    expect(body.error.correlationId).toBe("unknown");
  });
});
