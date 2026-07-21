import { DEFAULT_REDACT_KEYS, FORBIDDEN_LOG_KEYS, redactionPatterns } from "./patterns.js";

export const REDACTED = "[REDACTED]" as const;

export type RedactionOptions = {
  extraKeys?: ReadonlySet<string>;
  extraPatterns?: ReadonlyArray<RegExp>;
};

function isRedactedByKey(key: string, extraKeys?: ReadonlySet<string>): boolean {
  if (DEFAULT_REDACT_KEYS.has(key)) return true;
  if (FORBIDDEN_LOG_KEYS.has(key)) return true;
  if (extraKeys?.has(key)) return true;
  return false;
}

function isRedactedByPattern(key: string, extraPatterns?: ReadonlyArray<RegExp>): boolean {
  for (const p of redactionPatterns) {
    if (p.test(key)) return true;
  }
  for (const p of extraPatterns ?? []) {
    if (p.test(key)) return true;
  }
  return false;
}

export function isRedactedKey(key: string, options?: RedactionOptions): boolean {
  return (
    isRedactedByKey(key, options?.extraKeys) || isRedactedByPattern(key, options?.extraPatterns)
  );
}

export function redactValue(value: unknown, options?: RedactionOptions): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, options));
  }
  if (typeof value === "object") {
    return redact(value as Record<string, unknown>, options);
  }
  return value;
}

export function redact<T>(input: T, options?: RedactionOptions): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactValue(v, options)) as unknown as T;
  }
  if (typeof input !== "object") return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (isRedactedByKey(k, options?.extraKeys) || isRedactedByPattern(k, options?.extraPatterns)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, options);
    }
  }
  return out as T;
}
