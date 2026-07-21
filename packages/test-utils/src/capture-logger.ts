export type CapturedLog = {
  raw: string;
  parsed: Record<string, unknown> | null;
};

export type LoggerSink = {
  (line: string): void;
  readonly lines: ReadonlyArray<CapturedLog>;
  reset(): void;
};

export function captureLogger(): LoggerSink {
  const captured: CapturedLog[] = [];
  const sink = ((line: string) => {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    captured.push({ raw: line, parsed });
  }) as LoggerSink;
  Object.defineProperty(sink, "lines", {
    get: () => captured,
    enumerable: true,
  });
  sink.reset = (): void => {
    captured.length = 0;
  };
  return sink;
}
