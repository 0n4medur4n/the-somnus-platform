/**
 * Key names that must never appear in a log line, case-insensitive.
 * The list is explicit; we do not rely on a generic regex to "guess"
 * what is sensitive. Adding a new field here is a code change, not a
 * configuration change, on purpose.
 */
export const DEFAULT_REDACT_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "authorization",
  "bearer",
  "apikey",
  "api_key",
  "cookie",
  "set-cookie",
  "session",
  "sessionid",
  "private_key",
  "client_secret",
]);

/**
 * Health-related fields that must never appear in log output, even
 * though they are not "credentials". The build plan §15 forbids
 * logging health data; we honor that at the redaction layer.
 */
export const FORBIDDEN_LOG_KEYS: ReadonlySet<string> = new Set([
  "answer",
  "answers",
  "free_text",
  "freeText",
  "symptom",
  "symptoms",
  "medication",
  "medications",
  "diagnosis",
  "diagnoses",
  "assessment_score",
  "safety_flag",
  "report_body",
  "questionnaire_response",
  "morpheo_result",
  "morpheo_payload",
]);

/**
 * Substring patterns that force-redact a value even when the key is
 * unfamiliar. These match anywhere in the key name. Adding a pattern
 * here is a deliberate decision; the list is short and conservative.
 */
export const redactionPatterns: ReadonlyArray<RegExp> = Object.freeze([
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /bearer/i,
  /api[_-]?key/i,
  /cookie/i,
  /session/i,
  /authorization/i,
  /\bauth\b/i,
  /health/i,
  /diagnosis/i,
  /\bsymptom/i,
  /\bmedication/i,
  /assessment/i,
  /score/i,
  /safety[_-]?flag/i,
  /morpheo[_-]?(result|payload)/i,
  /free[_-]?text/i,
]);
