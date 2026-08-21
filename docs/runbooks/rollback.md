# Runbook: rollback

Build plan **Checkpoint 13.2** ("rollback runbook"), **§17** migration-rollback
policy, and **§21**. Two independent things can be rolled back — **the running
code** (a Cloud Run revision) and **a database migration** — and they follow
different rules. Roll back **only the changed deployable**; the platform builds
and deploys services independently (ADR 0002).

---

## 1. Code rollback (Cloud Run revision)

Cloud Run keeps every prior revision. Rolling back is a **traffic switch**, not a
rebuild, so it is near-instant and needs no CI run.

1. **Identify** the last-good revision of the affected service:
   ```bash
   gcloud run revisions list --service <service> --region europe-west3
   ```
2. **Shift 100% traffic** back to it:
   ```bash
   gcloud run services update-traffic <service> \
     --region europe-west3 --to-revisions <last-good-revision>=100
   ```
3. **Verify** the readiness probe passes and run a smoke read. Min-instances
   stays **0** — no warm-up is added.
4. **Record** the rollback in the incident log if one is open.

This is the **first response** for a bad deploy: switch traffic to the last-good
revision, then diagnose the broken one out of the serving path.

---

## 2. Migration rollback (Drizzle / Alembic)

Policy (**§17**): *every migration is reversible, or explicitly documented as
irreversible with a stated recovery path, reviewed in the pull request.* So the
rollback path was decided **before merge** — this runbook executes it, it does not
invent it.

**Ordering matters.** A migration and the code that depends on it deploy together.
To roll back safely:

1. **Roll back code first** (§1) to the revision that predates the schema change,
   so no serving code expects the new schema.
2. **Then reverse the migration** against the owning service's database **only**:
   - **Drizzle (identity, consent, worker):** apply the paired down-migration /
     revert script reviewed in the PR.
   - **Alembic (morpheo, report, content):** `alembic downgrade -1` (or to the
     named revision) inside the service's `uv` environment.
   Each database has an **independent migration history** (§17); reversing one
   never touches another.
3. **If the migration was documented as irreversible** (e.g. a destructive column
   drop), do **not** improvise — follow the **recovery path recorded in the PR**,
   which for data-losing changes means a **restore** from backup
   (`docs/runbooks/backup-restore.md`) to the pre-migration point, not a downgrade.
4. **Validate** with the per-database checklist in `backup-restore.md` §3
   (migration head, row-count sanity, owner-only smoke test).

> Never reverse a migration while code that expects the new schema is still
> serving traffic — roll the code back first.

---

## 3. Promotion-pipeline rollback

The promotion path is PR → CI → dev → approved promotion → staging → manual
approval → production, and **only changed services build/deploy** (Checkpoint
13.3). To roll a bad promotion back:

- **Production / staging:** switch the affected service's traffic to its
  last-good revision (§1). Because promotion is per-service, this rolls back
  exactly the service that regressed, not the whole platform.
- **Re-promote forward** only after the fix has gone green through dev and
  staging again — never hot-patch production directly.

---

## 4. Post-rollback

- Confirm monitoring is back to baseline (5xx, readiness, pool, dead-letter,
  report failures, auth anomalies, cost).
- If the rollback was part of an incident, complete the review in
  `docs/runbooks/incident-response.md` §2.6 and add any new attack surface to
  `docs/security/threat-validation.md` with a proving test.
