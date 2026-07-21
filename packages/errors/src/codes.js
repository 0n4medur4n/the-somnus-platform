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
  // 5xx
  INTERNAL: "INTERNAL",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  CONFIGURATION_INVALID: "CONFIGURATION_INVALID",
  DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE",
};
export const errorCodeToHttpStatus = Object.freeze({
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
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 502,
  CONFIGURATION_INVALID: 500,
  DEPENDENCY_FAILURE: 500,
});
export const SAFE_PUBLIC_MESSAGES = Object.freeze({
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
  INTERNAL: "An internal error occurred.",
  UPSTREAM_UNAVAILABLE: "An upstream service is unavailable.",
  CONFIGURATION_INVALID: "The service is misconfigured.",
  DEPENDENCY_FAILURE: "A required dependency is unavailable.",
});
export function isSomnusError(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.name === "SomnusError" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  );
}
export function toHttpResponse(code, correlationId, details = {}) {
  return Object.freeze({
    error: Object.freeze({
      code,
      message: SAFE_PUBLIC_MESSAGES[code],
      correlationId,
      details: Object.freeze({ ...details }),
    }),
  });
}
export function toLogShape(code, message, correlationId, details = {}) {
  return Object.freeze({
    code,
    message,
    correlationId,
    details: Object.freeze({ ...details }),
  });
}
//# sourceMappingURL=codes.js.map
