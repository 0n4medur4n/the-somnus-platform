# @somnus/observability

Structured JSON logger, field-level redaction, correlation IDs, and
an OpenTelemetry tracer wrapper that becomes a no-op when no SDK is
registered. Used by every service.

## Redaction

The redaction list is explicit. The build plan (§19) requires that a
redaction test prove tokens, cookies, and health fields never appear
in log output. See `src/patterns.ts` for the list and
`src/logger.test.ts` for the proof.

## OpenTelemetry

Locally, no SDK is registered, so the tracer is a no-op (the build
plan §3.8 calls this a "no-op exporter locally"). In production, the
service's bootstrap registers the `@opentelemetry/sdk-node` exporter
that targets Cloud Trace. The tracer interface here does not change.

## Usage

```ts
import { createLogger, correlationIdMiddleware, getTracer } from "@somnus/observability";

const logger = createLogger({ service: cfg.service, correlationId: req.correlationId });
const tracer = getTracer();
tracer.startSpan("load_user", (span) => {
  span.setAttribute("user.id", userId);
  // ...
  span.end();
});
```

## Build plan

Implements build plan §20 Phase 2 / Checkpoint 2.1.
