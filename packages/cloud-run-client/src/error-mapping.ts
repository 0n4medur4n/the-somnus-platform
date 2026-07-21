import { ApiErrorResponseSchema } from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { UpstreamErrorContext } from "./error-mapping.js";

export function mapHttpErrorToSomnusError(
  status: number,
  body: unknown,
  context: UpstreamErrorContext,
): SomnusError {
  const parsed = ApiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    const e = parsed.data.error;
    const code = isKnownErrorCode(e.code)
      ? (e.code as keyof typeof ErrorCode)
      : mapStatusToCode(status);
    return new SomnusError(ErrorCode[code], e.message, {
      correlationId: context.correlationId,
      details: { upstreamStatus: status, upstreamCode: e.code, ...e.details },
    });
  }
  return new SomnusError(mapStatusToCode(status), context.fallbackMessage, {
    correlationId: context.correlationId,
    details: { upstreamStatus: status },
  });
}

function isKnownErrorCode(value: string): value is keyof typeof ErrorCode {
  return (Object.values(ErrorCode) as string[]).includes(value);
}

function mapStatusToCode(status: number): keyof typeof ErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 412) return "CONSENT_REQUIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 502) return "UPSTREAM_UNAVAILABLE";
  if (status === 503) return "UPSTREAM_UNAVAILABLE";
  if (status === 504) return "UPSTREAM_UNAVAILABLE";
  return "INTERNAL";
}
