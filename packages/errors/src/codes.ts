export const ErrorCode = {
  // 4xx
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF_REJECTED: "CSRF_REJECTED",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN",
  PROFESSIONAL_NOT_VERIFIED: "PROFESSIONAL_NOT_VERIFIED",
  ORGANIZATION_MEMBERSHIP_NOT_FOUND: "ORGANIZATION_MEMBERSHIP_NOT_FOUND",
  ACCESS_GRANT_EXPIRED: "ACCESS_GRANT_EXPIRED",
  // Invitations are the only way into a Nox organization (Addendum A §A1),
  // so the reason one cannot be used is a distinct, stable code the frontend
  // translates -- never a generic 404 that would leave "expired", "already
  // used" and "wrong account" indistinguishable to the invited person.
  INVITATION_NOT_FOUND: "INVITATION_NOT_FOUND",
  INVITATION_EXPIRED: "INVITATION_EXPIRED",
  INVITATION_ALREADY_USED: "INVITATION_ALREADY_USED",
  INVITATION_EMAIL_MISMATCH: "INVITATION_EMAIL_MISMATCH",
  // 5xx
  INTERNAL: "INTERNAL",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  CONFIGURATION_INVALID: "CONFIGURATION_INVALID",
  DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export const errorCodeToHttpStatus: Readonly<Record<ErrorCodeType, number>> = Object.freeze({
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_REJECTED: 403,
  CONSENT_REQUIRED: 412,
  CONSENT_WITHDRAWN: 412,
  PROFESSIONAL_NOT_VERIFIED: 403,
  ORGANIZATION_MEMBERSHIP_NOT_FOUND: 404,
  ACCESS_GRANT_EXPIRED: 410,
  INVITATION_NOT_FOUND: 404,
  INVITATION_EXPIRED: 410,
  INVITATION_ALREADY_USED: 409,
  INVITATION_EMAIL_MISMATCH: 403,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 502,
  CONFIGURATION_INVALID: 500,
  DEPENDENCY_FAILURE: 500,
});

export const SAFE_PUBLIC_MESSAGES: Readonly<Record<ErrorCodeType, string>> = Object.freeze({
  VALIDATION_FAILED: "The request was invalid.",
  UNAUTHENTICATED: "Authentication is required.",
  FORBIDDEN: "You are not allowed to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  CONFLICT: "The resource already exists or is in conflict.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  CSRF_REJECTED: "Cross-site request forgery check failed.",
  CONSENT_REQUIRED: "Required consent has not been granted.",
  CONSENT_WITHDRAWN: "Required consent has been withdrawn.",
  PROFESSIONAL_NOT_VERIFIED: "Professional verification is required.",
  ORGANIZATION_MEMBERSHIP_NOT_FOUND: "The requested membership could not be found.",
  ACCESS_GRANT_EXPIRED: "The access grant has expired.",
  INVITATION_NOT_FOUND: "The invitation could not be found.",
  INVITATION_EXPIRED: "The invitation has expired.",
  INVITATION_ALREADY_USED: "The invitation has already been used.",
  INVITATION_EMAIL_MISMATCH: "The invitation was issued to a different email address.",
  INTERNAL: "An internal error occurred.",
  UPSTREAM_UNAVAILABLE: "An upstream service is unavailable.",
  CONFIGURATION_INVALID: "The service is misconfigured.",
  DEPENDENCY_FAILURE: "A required dependency is unavailable.",
});

export type HttpErrorResponse = {
  error: {
    code: ErrorCodeType;
    message: string;
    correlationId: string;
    details: Readonly<Record<string, unknown>>;
  };
};

export type LogErrorShape = {
  code: ErrorCodeType;
  message: string;
  correlationId: string;
  details: Readonly<Record<string, unknown>>;
};

export function isSomnusError(value: unknown): value is {
  name: string;
  code: ErrorCodeType;
  message: string;
  details: Readonly<Record<string, unknown>>;
  correlationId: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "SomnusError" &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

export function toHttpResponse(
  code: ErrorCodeType,
  correlationId: string,
  details: Readonly<Record<string, unknown>> = {},
): HttpErrorResponse {
  return Object.freeze({
    error: Object.freeze({
      code,
      message: SAFE_PUBLIC_MESSAGES[code],
      correlationId,
      details: Object.freeze({ ...details }),
    }),
  });
}

export function toLogShape(
  code: ErrorCodeType,
  message: string,
  correlationId: string,
  details: Readonly<Record<string, unknown>> = {},
): LogErrorShape {
  return Object.freeze({
    code,
    message,
    correlationId,
    details: Object.freeze({ ...details }),
  });
}
