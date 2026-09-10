# somnus-worker

The Somnus background worker (build plan §5.7). Private Cloud Run service, NestJS
11 + Fastify 5, cloned from the identity NestJS template (Checkpoint 3.1).

Two **isolated modules** will live here, each owning its own logical database and
reached only through its public interface (ADR 0010):

- **Notification** (`somnus_notifications`) — Cloud Tasks consumer, Brevo delivery,
  localized templates (4 locales), idempotency keys, retries / max attempts /
  dead-letter, delivery status. Emails carry secure links, **never health details**.
- **Audit** (`somnus_audit`) — normalized audit records (§5.7 / §17), deduped by
  event id, with a privacy-safe BigQuery export and the Phase 15 read side: the
  audit log viewer and the statistics dashboards.

Plus scheduled jobs (Cloud Scheduler): unclaimed-assessment and claim-token cleanup.

## Status

- **12.1 — Notifications (DONE):** the isolated Notification module. A Cloud Tasks
  consumer (`POST /internal/v1/notifications/tasks`) validates the `NotificationTask`
  contract, dedupes by idempotency key, renders a localized email (4 locales, secure
  link, **no health details**), delivers via the Brevo adapter (mocked in tests), and
  records delivery status in `somnus_notifications`. A 5xx asks Cloud Tasks to retry;
  after max attempts the task is dead-lettered. Emails: invitation + report-ready.
- **Audit (DONE):** ingest + redacted export, plus Checkpoint 15.4's viewer and
  dashboards and Checkpoint 15.5's break-glass counter. Two properties worth
  knowing before touching it:
  - The dashboards compute over rows passed through `redactForExport` — the same
    function that produces the BigQuery rows — so the screen and the warehouse
    cannot disagree, and there is no second export path.
  - `audit_records.justification` is a column, not a key inside `data`. §17
    forbids free text in an event payload, and §A2.3 requires a break-glass
    access to record the admin's written reason. Keeping it in a column means
    the export row's fixed shape has no field it could travel in, so it cannot
    reach BigQuery whatever anyone later adds to a denylist. `AuditService`
    lifts it out of the incoming payload on ingest, for every event type.
- Scheduled jobs are **Checkpoint 12.2**.

## Develop

```bash
pnpm --filter @somnus/worker build
pnpm --filter @somnus/worker test:coverage
```

Min instances 0 (build plan §2); the container is non-root and exposes `/health/live`.
