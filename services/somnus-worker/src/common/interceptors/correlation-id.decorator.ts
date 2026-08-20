import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

export const CORRELATION_ID_HEADER = "x-correlation-id";
export const REQUEST_CORRELATION_ID = "correlationId";

/**
 * @Param decorator: returns the correlation ID injected by the
 * CorrelationInterceptor, or undefined if no interceptor ran.
 */
export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { correlationId?: string }>();
    return req.correlationId;
  },
);
