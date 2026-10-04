import { type ArgumentsHost, Logger } from "@nestjs/common";
import { ErrorCode, SomnusError } from "@somnus/errors";
import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
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

  it("logs a database failure's driver code, and never its params or a credential", () => {
    // What reaches the operator log, captured at the logger itself -- not what
    // the helper returns. Until 2026-10 this line was `exception.message`:
    // Drizzle's `Failed query: … params: …`, which printed every bound value
    // and none of the driver's diagnosis.
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const filter = new SomnusExceptionFilter();
      const { host, getSent } = makeHost();
      const cause = Object.assign(
        new Error(
          "Access denied for user '4JdTF3GpJN7acjW.root'@'10.0.0.7' (using password: YES) " +
            "connecting to mysql://4JdTF3GpJN7acjW.root:S3cretPassw0rd@gateway01.example.com:4000/somnus_identity",
        ),
        { code: "ER_ACCESS_DENIED_ERROR", errno: 1045, sqlState: "28000" },
      );
      const exc = new DrizzleQueryError(
        "select `id` from `users` where `users`.`email` = ? limit ?",
        ["alice@example.com", 1],
        cause,
      );

      filter.catch(exc, host("c-db"));

      expect(getSent()?.status).toBe(500);
      const logged = warn.mock.calls.map((call) => String(call[0])).join(" ");

      expect(logged).toContain("code=ER_ACCESS_DENIED_ERROR");
      expect(logged).toContain("errno=1045");
      expect(logged).toContain("sqlState=28000");

      expect(logged).not.toContain("S3cretPassw0rd");
      expect(logged).not.toContain("4JdTF3GpJN7acjW.root");
      expect(logged).not.toContain("alice@example.com");
      expect(logged).not.toContain("params:");
    } finally {
      warn.mockRestore();
    }
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
