import type { LoggerService } from "@nestjs/common";
import type { Logger } from "@somnus/observability";

/**
 * Adapter from NestJS LoggerService to the @somnus/observability
 * structured JSON logger. Replaces the global console logger so every
 * Nest-emitted log line goes through the same redaction pipeline.
 */
export class SomnusLogger implements LoggerService {
  private static currentLogger: Logger | null = null;

  static replaceGlobalLogger(logger: Logger): void {
    SomnusLogger.currentLogger = logger;
  }

  log(message: unknown, context?: string): void {
    SomnusLogger.currentLogger?.info(String(message), this.bindings(context));
  }

  error(message: unknown, trace?: string, context?: string): void {
    SomnusLogger.currentLogger?.error(String(message), {
      ...this.bindings(context),
      // We never log raw traces. The §16 error shape carries the
      // code, message, correlationId, and details — those are the
      // information the operator needs.
      hasTrace: typeof trace === "string" && trace.length > 0,
    });
  }

  warn(message: unknown, context?: string): void {
    SomnusLogger.currentLogger?.warn(String(message), this.bindings(context));
  }

  debug(message: unknown, context?: string): void {
    SomnusLogger.currentLogger?.debug(String(message), this.bindings(context));
  }

  verbose(message: unknown, context?: string): void {
    SomnusLogger.currentLogger?.debug(String(message), this.bindings(context));
  }

  private bindings(context?: unknown): Record<string, unknown> {
    if (typeof context === "string" && context.length > 0) {
      return { component: context };
    }
    if (context && typeof context === "object") {
      return { ...(context as Record<string, unknown>) };
    }
    return {};
  }
}
