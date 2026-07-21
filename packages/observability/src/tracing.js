import { trace } from "@opentelemetry/api";

const NOOP_SPAN = {
  setAttribute: (_k, _v) => {
    /* no-op */
  },
  recordException: (_e) => {
    /* no-op */
  },
  end: () => {
    /* no-op */
  },
};
class NoopTracer {
  startSpan(_name, fn) {
    return fn(NOOP_SPAN);
  }
}
class OtelWrappedTracer {
  inner;
  constructor(inner) {
    this.inner = inner;
  }
  startSpan(name, fn) {
    const span = this.inner.startSpan(name);
    return fn({
      setAttribute: (k, v) => {
        span.setAttribute(k, v);
      },
      recordException: (e) => {
        span.recordException(e);
      },
      end: () => {
        span.end();
      },
    });
  }
}
export function getTracer(name = "@somnus/observability") {
  const ot = trace.getTracer(name);
  // The OTel API returns a no-op tracer if no SDK is registered, so the
  // wrapped instance is safe even when running locally without a backend.
  // The build plan explicitly accepts a no-op exporter in dev (§3.8).
  return new OtelWrappedTracer(ot);
}
export function noopTracer() {
  return new NoopTracer();
}
//# sourceMappingURL=tracing.js.map
