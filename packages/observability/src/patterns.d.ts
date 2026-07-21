/**
 * Key names that must never appear in a log line, case-insensitive.
 * The list is explicit; we do not rely on a generic regex to "guess"
 * what is sensitive. Adding a new field here is a code change, not a
 * configuration change, on purpose.
 */
export declare const DEFAULT_REDACT_KEYS: ReadonlySet<string>;
/**
 * Health-related fields that must never appear in log output, even
 * though they are not "credentials". The build plan §15 forbids
 * logging health data; we honor that at the redaction layer.
 */
export declare const FORBIDDEN_LOG_KEYS: ReadonlySet<string>;
/**
 * Substring patterns that force-redact a value even when the key is
 * unfamiliar. These match anywhere in the key name. Adding a pattern
 * here is a deliberate decision; the list is short and conservative.
 */
export declare const redactionPatterns: ReadonlyArray<RegExp>;
//# sourceMappingURL=patterns.d.ts.map
