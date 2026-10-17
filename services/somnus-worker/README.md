# somnus-worker

The Somnus background worker (build plan §5.7). Private Cloud Run service, NestJS
11 + Fastify 5, cloned from the identity NestJS template (Checkpoint 3.1).

Three **isolated modules** live here, each owning its own logical database and
reached only through its public interface (ADR 0010):

- **Notification** (`somnus_notifications`) — Cloud Tasks consumer, Brevo delivery,
  localized templates (4 locales), idempotency keys, retries / max attempts /
  dead-letter, delivery status. Emails carry secure links, **never health details**.
- **Audit** (`somnus_audit`) — normalized audit records (§5.7 / §17), deduped by
  event id, with a privacy-safe BigQuery export and the Phase 15 read side: the
  audit log viewer and the statistics dashboards.

- **Drive** (a private Cloud Storage bucket, owner decisions 2026-10-17/18, ADR 0019) — the admin
  console's staff Drive. Stores **ciphertext, public keys and folder membership
  only**: names, notes and files are encrypted in the browser, and this module
  holds no key that opens them. It decides who may *ask* for what (membership,
  roles owner/editor/viewer, a folder always keeps an owner, uploads complete
  before they are visible) and refuses a member removal that does not rotate
  the folder key for exactly the remaining members and every node.

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

## The Drive module, in short

- Internal API `internal/v1/drive/*`, called only by edge-api, which sets
  `x-somnus-actor-id` (and `x-somnus-actor-email` on enroll/reset) from the
  server-side session after identity granted `admin_drive`. A request without a
  well-formed actor is refused before any Drive rule runs.
- Pure rules in `drive.policy.ts`, the service over `DriveStore`, and
  `DriveStore` over an `ObjectStore`: `GcsObjectStore` in production (the
  worker's own identity, no key), `MemoryObjectStore` in development and tests
  -- same generation preconditions, so the service tests exercise the real
  compare-and-swap, concurrent writers included.
- One manifest object per folder, replaced only by compare-and-swap on its
  generation; every rule is checked inside the swap. Blocks are separate
  objects (512 KiB AES-GCM, at most 40 per file). A new revision deletes the
  previous one's blocks on commit; abandoned uploads go after 24 h.
- `DRIVE_BUCKET` unset: memory in development, a refusal in production
  (account erasure then has nothing to erase). See `docs/runbooks/deploy-dev.md`.

## Develop

```bash
pnpm --filter @somnus/worker build
pnpm --filter @somnus/worker test:coverage
```

Min instances 0 (build plan §2); the container is non-root and exposes `/health/live`.
