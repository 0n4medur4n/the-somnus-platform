import { ErrorCode, type ErrorCodeType } from "./codes.js";

export class SomnusError extends Error {
  public readonly name = "SomnusError" as const;
  public readonly code: ErrorCodeType;
  public readonly correlationId: string;
  public readonly details: Readonly<Record<string, unknown>>;
  public readonly cause?: unknown;

  constructor(
    code: ErrorCodeType,
    message: string,
    options: {
      correlationId: string;
      details?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    },
  ) {
    super(message);
    this.code = code;
    this.correlationId = options.correlationId;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): {
    name: string;
    code: ErrorCodeType;
    message: string;
    correlationId: string;
    details: Readonly<Record<string, unknown>>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
      details: this.details,
    };
  }
}

export function isSomnusErrorInstance(value: unknown): value is SomnusError {
  return value instanceof SomnusError;
}

export { ErrorCode };
