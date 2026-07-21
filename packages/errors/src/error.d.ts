import { ErrorCode, type ErrorCodeType } from "./codes.js";
export declare class SomnusError extends Error {
  readonly name: "SomnusError";
  readonly code: ErrorCodeType;
  readonly correlationId: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  constructor(
    code: ErrorCodeType,
    message: string,
    options: {
      correlationId: string;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    },
  );
  toJSON(): {
    name: string;
    code: ErrorCodeType;
    message: string;
    correlationId: string;
    details: Readonly<Record<string, unknown>>;
  };
}
export declare function isSomnusErrorInstance(value: unknown): value is SomnusError;
export { ErrorCode };
//# sourceMappingURL=error.d.ts.map
