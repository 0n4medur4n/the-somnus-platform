import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger as NestLogger,
} from "@nestjs/common";
import { ApiErrorResponseSchema } from "@somnus/api-contracts";
import { ErrorCode, type ErrorCodeType, SomnusError, toHttpResponse } from "@somnus/errors";
import type { FastifyReply } from "fastify";

/**
 * Maps every thrown error to the §16 API response shape.
 *
 * - A `SomnusError` keeps its code, message, correlationId, and details.
 * - A Nest `HttpException` maps to a stable error code per status.
 * - Anything else maps to `INTERNAL` with a generic message and the
 *   real error logged once at warn level for the operator.
 *
 * In production, no stack trace ever reaches the response body.
 */
@Catch()
export class SomnusExceptionFilter implements ExceptionFilter {
  private readonly nestLogger = new NestLogger(SomnusExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<{ correlationId?: string }>();

    const correlationId = request.correlationId ?? "unknown";

    if (exception instanceof SomnusError) {
      const body = toHttpResponse(exception.code, correlationId, exception.details);
      this.send(reply, errorCodeToStatus(exception.code), body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = httpStatusToErrorCode(status);
      const body = toHttpResponse(code, correlationId, {});
      this.send(reply, status, body);
      return;
    }

    this.nestLogger.warn(
      `unhandled error: ${exception instanceof Error ? exception.message : String(exception)}`,
    );
    const body = toHttpResponse("INTERNAL" satisfies ErrorCodeType, correlationId, {});
    this.send(reply, 500, body);
  }

  private send(reply: FastifyReply, status: number, body: unknown): void {
    const parsed = ApiErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      reply.status(status).send(parsed.data);
    } else {
      reply.status(status).send(body);
    }
  }
}

// Local mapping that does not depend on the consumer's packages.
function errorCodeToStatus(code: ErrorCodeType): number {
  const c = ErrorCode;
  if (code === c.VALIDATION_FAILED) return 400;
  if (code === c.UNAUTHENTICATED) return 401;
  if (code === c.FORBIDDEN) return 403;
  if (code === c.NOT_FOUND) return 404;
  if (code === c.CONFLICT) return 409;
  if (code === c.RATE_LIMITED) return 429;
  if (code === c.CSRF_REJECTED) return 403;
  if (code === c.CONSENT_REQUIRED) return 412;
  if (code === c.CONSENT_WITHDRAWN) return 412;
  if (code === c.PROFESSIONAL_NOT_VERIFIED) return 403;
  if (code === c.ORGANIZATION_MEMBERSHIP_NOT_FOUND) return 404;
  if (code === c.ACCESS_GRANT_EXPIRED) return 410;
  if (code === c.UPSTREAM_UNAVAILABLE) return 502;
  return 500;
}

function httpStatusToErrorCode(status: number): ErrorCodeType {
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 412) return "CONSENT_REQUIRED";
  if (status === 410) return "ACCESS_GRANT_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502 || status === 503 || status === 504) return "UPSTREAM_UNAVAILABLE";
  return "INTERNAL";
}
