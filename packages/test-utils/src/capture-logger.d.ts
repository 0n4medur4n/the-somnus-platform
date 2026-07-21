export type CapturedLog = {
  raw: string;
  parsed: Record<string, unknown> | null;
};
export type LoggerSink = {
  (line: string): void;
  readonly lines: ReadonlyArray<CapturedLog>;
  reset(): void;
};
export declare function captureLogger(): LoggerSink;
//# sourceMappingURL=capture-logger.d.ts.map
