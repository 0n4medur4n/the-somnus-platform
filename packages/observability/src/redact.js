import { DEFAULT_REDACT_KEYS, FORBIDDEN_LOG_KEYS, redactionPatterns } from "./patterns.js";
export const REDACTED = "[REDACTED]";
function isRedactedByKey(key, extraKeys) {
  if (DEFAULT_REDACT_KEYS.has(key)) return true;
  if (FORBIDDEN_LOG_KEYS.has(key)) return true;
  if (extraKeys?.has(key)) return true;
  return false;
}
function isRedactedByPattern(key, extraPatterns) {
  for (const p of redactionPatterns) {
    if (p.test(key)) return true;
  }
  for (const p of extraPatterns ?? []) {
    if (p.test(key)) return true;
  }
  return false;
}
export function isRedactedKey(key, options) {
  return (
    isRedactedByKey(key, options?.extraKeys) || isRedactedByPattern(key, options?.extraPatterns)
  );
}
export function redactValue(value, options) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, options));
  }
  if (typeof value === "object") {
    return redact(value, options);
  }
  return value;
}
export function redact(input, options) {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactValue(v, options));
  }
  if (typeof input !== "object") return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (isRedactedByKey(k, options?.extraKeys) || isRedactedByPattern(k, options?.extraPatterns)) {
      out[k] = REDACTED;
    } else {
      out[k] = redactValue(v, options);
    }
  }
  return out;
}
//# sourceMappingURL=redact.js.map
