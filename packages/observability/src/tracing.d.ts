export type Tracer = {
  startSpan<T>(
    name: string,
    fn: (span: {
      setAttribute(k: string, v: string | number | boolean): void;
      recordException(e: unknown): void;
      end(): void;
    }) => T,
  ): T;
};
export declare function getTracer(name?: string): Tracer;
export declare function noopTracer(): Tracer;
//# sourceMappingURL=tracing.d.ts.map
