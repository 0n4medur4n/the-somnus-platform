import { type RedactionOptions } from "./redact.js";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Readonly<Record<string, unknown>>;
export type LogLine = {
  timestamp: string;
  level: LogLevel;
  service: {
    name: string;
    env: string;
    version: string;
    commit: string;
  };
  correlationId: string;
  durationMs?: number;
  message: string;
  data?: Readonly<Record<string, unknown>>;
  error?: {
    code: string;
    message: string;
    details?: Readonly<Record<string, unknown>>;
  };
};
export type Logger = {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
  withCorrelationId(correlationId: string): Logger;
};
export type LoggerOptions = {
  service: {
    name: string;
    env: string;
    version: string;
    commit: string;
  };
  correlationId: string;
  level?: LogLevel;
  format?: "json" | "text";
  write?: (line: string) => void;
  redaction?: RedactionOptions;
  bindings?: LogContext;
};
export declare function createLogger(options: LoggerOptions): Logger;
export declare function generateCorrelationId(): string;
//# sourceMappingURL=logger.d.ts.map
