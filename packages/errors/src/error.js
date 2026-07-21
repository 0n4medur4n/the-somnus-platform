import { ErrorCode } from "./codes.js";
export class SomnusError extends Error {
  name = "SomnusError";
  code;
  correlationId;
  details;
  cause;
  constructor(code, message, options) {
    super(message);
    this.code = code;
    this.correlationId = options.correlationId;
    this.details = Object.freeze({ ...(options.details ?? {}) });
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
      details: this.details,
    };
  }
}
export function isSomnusErrorInstance(value) {
  return value instanceof SomnusError;
}
export { ErrorCode };
//# sourceMappingURL=error.js.map
