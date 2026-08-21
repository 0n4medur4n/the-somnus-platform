# Runbook: backup & restore (per logical database)

Build plan **Checkpoint 13.2** ("backup/restore rehearsal per logical database,
documented") and **§21** ("backup/restore procedure"). Exit criterion:
*restore rehearsal documented.*

The Somnus data lives in **seven logical databases** on **TiDB Cloud** (managed
MySQL) plus **generated report artifacts** in **Cloud Storage**. Each logical
database is owned by one service/isolated module and is backed up and restored
**independently** (build plan §17: "separate backup validation"). A restore of
one database must never require touching another.

| Logical database | Owner | Restore priority |
|------------------|-------|------------------|
| `somnus_identity` | identity-service | P1 (blocks login) |
| `somnus_consent` | Consent module | P1 (legal gate) |
| `somnus_morpheo` | morpheo-service | P1 (assessment core) |
| `somnus_reporting` | report-service | P2 |
| `somnus_content` | content | P2 (re-seedable from artifacts) |
| `somnus_notifications` | Notification module | P3 |
| `somnus_audit` | Audit module | P2 (append-only, retained) |
| GCS report bucket | report-service | P2 |

---

## 1. What protects the data

- **TiDB Cloud automatic backups** — daily full snapshots with **point-in-time
  recovery (PITR)** within the retention window. Restores create a **new
  cluster/branch**; you never overwrite the live cluster in place.
- **Cloud Storage** — report bucket has **object versioning** enabled and is in
  `europe-west3`. Deletes/overwrites are recoverable within the versioning window.
- **Content is re-seedable** — `somnus_content` is derived from the checked-in
  clinical artifacts via Alembic seed migrations, so it has a second recovery
  path independent of backups.

All connections are TLS. Backups inherit the cluster's EU region.

---

## 2. Restore procedure (single logical database)

> Restore into a **new** TiDB Cloud cluster/branch first, validate, then cut the
> owning service over by swapping its Secret Manager connection secret. Never
> point a service at a half-restored database.

1. **Declare scope.** Identify the affected database and the target recovery
   point (timestamp for PITR, or the latest good snapshot).
2. **Restore to a new target.** In TiDB Cloud, restore the snapshot / PITR
   timestamp into a **new cluster or branch**. Do not modify the live cluster.
3. **Validate the restore** (see §3) against the new target.
4. **Repoint the owning service.** Update **only that service's** connection
   secret in Secret Manager (`the-somnus` project) to the restored target. Each
   logical database has a dedicated user/password/secret, so this touches one
   service.
5. **Roll the service.** Deploy a new Cloud Run revision (or restart) so it picks
   up the new secret. Min-instances stays 0.
6. **Verify health** — the service's readiness probe passes and a smoke read
   succeeds.
7. **Record** the event in §4 and, if data was lost, assess breach-notification
   duties with the DPIA owner.

For the **GCS report bucket**, restore is per-object via versioning
(`gsutil cp gs://…#<generation> gs://…`) or a bucket-level rollback of the
affected prefix; no cluster restore is involved.

---

## 3. Validation checklist (per database)

A restore is "good" only when all pass against the restored target:

- **Connectivity** — the owning service's dedicated user connects over TLS.
- **Migration head** — the schema is at the expected Alembic/Drizzle head
  (independent migration history per database, §17).
- **Row-count sanity** — key tables are within expected bounds vs. the last known
  metric (e.g. `users`, `assessment_sessions`, `consent_receipts`).
- **Referential integrity** — repository-layer invariants hold (identity/consent
  enforce integrity in the repo layer, not via FK; morpheo has FK constraints).
- **Owner-only smoke test** — run the service's integration smoke read against the
  restored database; no cross-database access is required or attempted.

---

## 4. Rehearsal record

A restore rehearsal must be performed **per logical database** and recorded here
before production sign-off, then re-run at least annually and after any major
schema change. Record the recovery point, elapsed time (RTO), the data loss
window (RPO), and the validation outcome.

| Date | Database | Recovery point | RTO | RPO | Validated | Operator | Notes |
|------|----------|----------------|-----|-----|-----------|----------|-------|
| _pending_ | `somnus_identity` | | | | | | first rehearsal required before prod |
| _pending_ | `somnus_consent` | | | | | | |
| _pending_ | `somnus_morpheo` | | | | | | |
| _pending_ | `somnus_reporting` | | | | | | |
| _pending_ | `somnus_content` | | | | | | verify re-seed path too |
| _pending_ | `somnus_notifications` | | | | | | |
| _pending_ | `somnus_audit` | | | | | | append-only; retained |
| _pending_ | GCS report bucket | | | | | | object-versioning restore |

> ⚠️ These rows are the exit gate for Checkpoint 13.2's "restore rehearsal
> documented." They are filled in as each rehearsal is run; do not mark the
> checkpoint's operational exit complete until at least the P1 databases have a
> recorded, validated rehearsal.
