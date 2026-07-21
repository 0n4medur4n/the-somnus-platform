import { ErrorCode, type ErrorCodeType } from "@somnus/errors";
import { z } from "zod";

/**
 * §16 response shape: every API error looks like this.
 * The `message` is intentionally a stable English string; the frontend
 * maps the `code` through i18n before showing anything to the user.
 */
export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: z.string().min(1).max(64),
    details: z.record(z.string(), z.unknown()).default({}),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

/**
 * Build a §16 error body using a known error code. Convenience for
 * services that want to send a typed error without a full Zod parse.
 */
export function buildApiErrorResponse(args: {
  code: ErrorCodeType;
  correlationId: string;
  details?: Readonly<Record<string, unknown>>;
}): ApiErrorResponse {
  return {
    error: {
      code: args.code,
      message: stableErrorMessage(args.code),
      correlationId: args.correlationId,
      details: { ...(args.details ?? {}) },
    },
  };
}

function stableErrorMessage(code: ErrorCodeType): string {
  return ErrorCode[code] ?? code;
}
