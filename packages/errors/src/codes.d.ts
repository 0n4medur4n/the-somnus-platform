export declare const ErrorCode: {
  readonly VALIDATION_FAILED: "VALIDATION_FAILED";
  readonly UNAUTHENTICATED: "UNAUTHENTICATED";
  readonly FORBIDDEN: "FORBIDDEN";
  readonly NOT_FOUND: "NOT_FOUND";
  readonly CONFLICT: "CONFLICT";
  readonly RATE_LIMITED: "RATE_LIMITED";
  readonly CSRF_REJECTED: "CSRF_REJECTED";
  readonly CONSENT_REQUIRED: "CONSENT_REQUIRED";
  readonly CONSENT_WITHDRAWN: "CONSENT_WITHDRAWN";
  readonly PROFESSIONAL_NOT_VERIFIED: "PROFESSIONAL_NOT_VERIFIED";
  readonly ORGANIZATION_MEMBERSHIP_NOT_FOUND: "ORGANIZATION_MEMBERSHIP_NOT_FOUND";
  readonly ACCESS_GRANT_EXPIRED: "ACCESS_GRANT_EXPIRED";
  readonly INTERNAL: "INTERNAL";
  readonly UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE";
  readonly CONFIGURATION_INVALID: "CONFIGURATION_INVALID";
  readonly DEPENDENCY_FAILURE: "DEPENDENCY_FAILURE";
};
export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
export declare const errorCodeToHttpStatus: Readonly<Record<ErrorCodeType, number>>;
export declare const SAFE_PUBLIC_MESSAGES: Readonly<Record<ErrorCodeType, string>>;
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
export declare function isSomnusError(value: unknown): value is {
  name: string;
  code: ErrorCodeType;
  message: string;
  details: Readonly<Record<string, unknown>>;
  correlationId: string;
};
export declare function toHttpResponse(
  code: ErrorCodeType,
  correlationId: string,
  details?: Readonly<Record<string, unknown>>,
): HttpErrorResponse;
export declare function toLogShape(
  code: ErrorCodeType,
  message: string,
  correlationId: string,
  details?: Readonly<Record<string, unknown>>,
): LogErrorShape;
//# sourceMappingURL=codes.d.ts.map
