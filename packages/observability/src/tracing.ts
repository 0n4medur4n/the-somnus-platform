import { type Tracer as OtelTracer, trace } from "@opentelemetry/api";

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

const NOOP_SPAN = {
  setAttribute: (_k: string, _v: string | number | boolean) => {
    /* no-op */
  },
  recordException: (_e: Error) => {
    /* no-op */
  },
  end: () => {
    /* no-op */
  },
};

class NoopTracer implements Tracer {
  startSpan<T>(_name: string, fn: (span: typeof NOOP_SPAN) => T): T {
    return fn(NOOP_SPAN);
  }
}

class OtelWrappedTracer implements Tracer {
  constructor(private readonly inner: OtelTracer) {}
  startSpan<T>(name: string, fn: (span: typeof NOOP_SPAN) => T): T {
    const span = this.inner.startSpan(name);
    return fn({
      setAttribute: (k, v) => {
        span.setAttribute(k, v);
      },
      recordException: (e) => {
        span.recordException(e as Error);
      },
      end: () => {
        span.end();
      },
    });
  }
}

export function getTracer(name = "@somnus/observability"): Tracer {
  const ot = trace.getTracer(name);
  // The OTel API returns a no-op tracer if no SDK is registered, so the
  // wrapped instance is safe even when running locally without a backend.
  // The build plan explicitly accepts a no-op exporter in dev (§3.8).
  return new OtelWrappedTracer(ot);
}

export function noopTracer(): Tracer {
  return new NoopTracer();
}
