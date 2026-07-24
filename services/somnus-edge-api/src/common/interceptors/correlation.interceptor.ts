import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { generateCorrelationId, type Logger } from "@somnus/observability";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type Observable, tap } from "rxjs";
import { CORRELATION_ID_HEADER, REQUEST_CORRELATION_ID } from "./correlation-id.decorator.js";

export const CORRELATION_LOGGER = "CORRELATION_LOGGER";

const VALID_CORRELATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Validates the incoming x-correlation-id, falls back to a fresh
 * nanoid(16) when missing or malformed, sets it on the request and
 * the response, and binds a child logger per request.
 */
@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  private readonly baseLogger: Logger;

  constructor(@Inject(CORRELATION_LOGGER) baseLogger: Logger) {
    this.baseLogger = baseLogger;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest & { correlationId?: string; somnusLog?: Logger }>();
    const res = http.getResponse<FastifyReply>();

    const incoming = readHeader(req.headers, CORRELATION_ID_HEADER);
    const correlationId =
      typeof incoming === "string" && VALID_CORRELATION_ID.test(incoming)
        ? incoming
        : generateCorrelationId();

    req.correlationId = correlationId;
    void res.header(CORRELATION_ID_HEADER, correlationId);
    req.somnusLog = this.baseLogger.withCorrelationId(correlationId);

    return next.handle().pipe(
      tap({
        next: () => req.somnusLog?.debug("request handled", { method: req.method, url: req.url }),
        error: () => req.somnusLog?.debug("request errored", { method: req.method, url: req.url }),
      }),
    );
  }
}

function readHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

// Marker import so the file is not tree-shaken if REQUEST_CORRELATION_ID
// is only referenced from elsewhere.
export { REQUEST_CORRELATION_ID };
