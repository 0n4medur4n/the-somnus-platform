import { nanoid } from "nanoid";
import { type RedactionOptions, redact } from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Readonly<Record<string, unknown>>;

export type LogLine = {
  timestamp: string;
  level: LogLevel;
  service: { name: string; env: string; version: string; commit: string };
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

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

export type LoggerOptions = {
  service: { name: string; env: string; version: string; commit: string };
  correlationId: string;
  level?: LogLevel;
  format?: "json" | "text";
  write?: (line: string) => void;
  redaction?: RedactionOptions;
  bindings?: LogContext;
};

function defaultWrite(line: string): void {
  process.stdout.write(`${line}\n`);
}

function buildLine(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  options: Required<
    Omit<LoggerOptions, "level" | "format" | "write" | "redaction" | "bindings">
  > & {
    level: LogLevel;
    format: "json" | "text";
    write: (line: string) => void;
    redaction?: RedactionOptions;
    bindings: LogContext;
  },
): LogLine {
  const merged: Record<string, unknown> = { ...options.bindings, ...(context ?? {}) };
  const safe = redact(merged, options.redaction) as Record<string, unknown>;
  const line: LogLine = {
    timestamp: new Date().toISOString(),
    level,
    service: options.service,
    correlationId: options.correlationId,
    message,
  };
  if ("durationMs" in safe && typeof safe["durationMs"] === "number") {
    line.durationMs = safe["durationMs"];
    delete safe["durationMs"];
  }
  if ("error" in safe) {
    const err = safe["error"];
    if (err && typeof err === "object" && !Array.isArray(err)) {
      const e = err as Record<string, unknown>;
      if (typeof e["code"] === "string" && typeof e["message"] === "string") {
        line.error = {
          code: e["code"],
          message: e["message"],
          ...(typeof e["details"] === "object" && e["details"] !== null
            ? { details: e["details"] as Record<string, unknown> }
            : {}),
        };
      }
    }
    delete safe["error"];
  }
  if (Object.keys(safe).length > 0) {
    line.data = Object.freeze(safe);
  }
  return line;
}

function formatLine(line: LogLine, format: "json" | "text"): string {
  if (format === "text") {
    const parts: string[] = [
      line.timestamp,
      line.level.toUpperCase().padEnd(5),
      `[${line.service.name}]`,
      line.message,
    ];
    if (line.correlationId) parts.push(`corr=${line.correlationId}`);
    if (line.durationMs !== undefined) parts.push(`durationMs=${line.durationMs}`);
    if (line.data && Object.keys(line.data).length > 0) {
      parts.push(JSON.stringify(line.data));
    }
    if (line.error) {
      parts.push(`error.code=${line.error.code} error.message=${line.error.message}`);
      if (line.error.details) parts.push(JSON.stringify(line.error.details));
    }
    return parts.join(" ");
  }
  return JSON.stringify(line);
}

export function createLogger(options: LoggerOptions): Logger {
  const level = options.level ?? "info";
  const format = options.format ?? "json";
  const write = options.write ?? defaultWrite;
  const redaction = options.redaction;
  const bindings = options.bindings ?? {};
  const fixedService = options.service;
  const fixedCorrelationId = options.correlationId;
  const fixedBindings: Readonly<Record<string, unknown>> = bindings;

  function logAt(targetLevel: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_RANK[targetLevel] < LEVEL_RANK[level]) return;
    const line = buildLine(targetLevel, message, context, {
      service: fixedService,
      correlationId: fixedCorrelationId,
      level,
      format,
      write,
      redaction,
      bindings: fixedBindings,
    });
    write(formatLine(line, format));
  }

  return {
    debug: (m, c) => logAt("debug", m, c),
    info: (m, c) => logAt("info", m, c),
    warn: (m, c) => logAt("warn", m, c),
    error: (m, c) => logAt("error", m, c),
    child(extra: LogContext): Logger {
      return createLogger({
        service: fixedService,
        correlationId: fixedCorrelationId,
        level,
        format,
        write,
        redaction,
        bindings: { ...fixedBindings, ...extra },
      });
    },
    withCorrelationId(c: string): Logger {
      return createLogger({
        service: fixedService,
        correlationId: c,
        level,
        format,
        write,
        redaction,
        bindings: fixedBindings,
      });
    },
  };
}

export function generateCorrelationId(): string {
  return nanoid(16);
}
