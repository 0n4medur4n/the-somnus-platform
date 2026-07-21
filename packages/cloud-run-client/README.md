# @somnus/cloud-run-client

Authenticated HTTP client used by the edge API to call private Cloud
Run services. The transport is injectable, so tests can fake the
network without touching the real `fetch`.

## What it does

- **OIDC**: a `TokenProvider` returns a Google ID token with an
  explicit `audience` for the target service. The token goes into
  `Authorization: Bearer …`.
- **Correlation propagation**: every request carries
  `x-correlation-id` so the downstream service can keep the trace.
- **Timeouts**: per-request `timeoutMs` (default 5s); the transport
  is aborted when the timeout fires.
- **Retry**: bounded exponential backoff with jitter for retriable
  statuses (408/425/429/5xx) and retriable network errors. Non-retriable
  failures map immediately to a `SomnusError` (see
  `error-mapping.ts`).
- **Error mapping**: a non-2xx upstream response with the §16 shape
  is converted into a `SomnusError` carrying the upstream code and
  status; an unparseable body falls back to a status-based code.

## What it does NOT do

- It does not own the connection pool. Cloud Run fronts the upstream
  services with mTLS and identity tokens; the client is a thin,
  retry-aware wrapper.
- It does not log raw bodies, tokens, or cookies. Logs at the
  service layer are responsible for redaction (see
  `@somnus/observability`).

## Build plan

Implements build plan §20 Phase 2 / Checkpoint 2.2.
