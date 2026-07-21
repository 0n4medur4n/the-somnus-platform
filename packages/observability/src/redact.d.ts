export declare const REDACTED: "[REDACTED]";
export type RedactionOptions = {
  extraKeys?: ReadonlySet<string>;
  extraPatterns?: ReadonlyArray<RegExp>;
};
export declare function isRedactedKey(key: string, options?: RedactionOptions): boolean;
export declare function redactValue(value: unknown, options?: RedactionOptions): unknown;
export declare function redact<T>(input: T, options?: RedactionOptions): T;
//# sourceMappingURL=redact.d.ts.map
