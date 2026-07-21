import { nanoid } from "nanoid";
import { redact } from "./redact.js";

const LEVEL_RANK = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});
function defaultWrite(line) {
  process.stdout.write(`${line}\n`);
}
function buildLine(level, message, context, options) {
  const merged = { ...options.bindings, ...(context ?? {}) };
  const safe = redact(merged, options.redaction);
  const line = {
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
      const e = err;
      if (typeof e["code"] === "string" && typeof e["message"] === "string") {
        line.error = {
          code: e["code"],
          message: e["message"],
          ...(typeof e["details"] === "object" && e["details"] !== null
            ? { details: e["details"] }
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
function formatLine(line, format) {
  if (format === "text") {
    const parts = [
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
export function createLogger(options) {
  const level = options.level ?? "info";
  const format = options.format ?? "json";
  const write = options.write ?? defaultWrite;
  const redaction = options.redaction;
  const bindings = options.bindings ?? {};
  const fixedService = options.service;
  const fixedCorrelationId = options.correlationId;
  const fixedBindings = bindings;
  function logAt(targetLevel, message, context) {
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
    child(extra) {
      return createLogger({
        service: fixedService,
        correlationId: fixedCorrelationId,
        level,
        format,
        write,
        bindings: { ...fixedBindings, ...extra },
        ...(redaction ? { redaction } : {}),
      });
    },
    withCorrelationId(c) {
      return createLogger({
        service: fixedService,
        correlationId: c,
        level,
        format,
        write,
        bindings: fixedBindings,
        ...(redaction ? { redaction } : {}),
      });
    },
  };
}
export function generateCorrelationId() {
  return nanoid(16);
}
//# sourceMappingURL=logger.js.map
