# somnus-worker

The Somnus background worker (build plan §5.7). Private Cloud Run service, NestJS
11 + Fastify 5, cloned from the identity NestJS template (Checkpoint 3.1).

Two **isolated modules** will live here, each owning its own logical database and
reached only through its public interface (ADR 0010):

- **Notification** (`somnus_notifications`) — Cloud Tasks consumer, Brevo delivery,
  localized templates (4 locales), idempotency keys, retries / max attempts /
  dead-letter, delivery status. Emails carry secure links, **never health details**.
- **Audit** (`somnus_audit`) — Checkpoint 12.2 (not built yet).

Plus scheduled jobs (Cloud Scheduler): unclaimed-assessment and claim-token cleanup.

## Status

- **12.1 — Notifications (DONE):** the isolated Notification module. A Cloud Tasks
  consumer (`POST /internal/v1/notifications/tasks`) validates the `NotificationTask`
  contract, dedupes by idempotency key, renders a localized email (4 locales, secure
  link, **no health details**), delivers via the Brevo adapter (mocked in tests), and
  records delivery status in `somnus_notifications`. A 5xx asks Cloud Tasks to retry;
  after max attempts the task is dead-lettered. Emails: invitation + report-ready.
- Audit module + scheduled jobs are **Checkpoint 12.2** (not built).

## Develop

```bash
pnpm --filter @somnus/worker build
pnpm --filter @somnus/worker test:coverage
```

Min instances 0 (build plan §2); the container is non-root and exposes `/health/live`.
