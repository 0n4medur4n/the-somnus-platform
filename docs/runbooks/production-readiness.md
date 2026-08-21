# Production readiness — Definition-of-Done sweep

Build plan **Checkpoint 13.3** final step: a Definition-of-Done sweep (**§22**)
across all deployables, and the readiness gaps as a **numbered list**. This is the
phase-closing audit — it records what is green and what a human must still do
before production traffic.

**Deployables (7):** 2 static frontends (Astro marketing, Vite+React SPA) + 5
Cloud Run services (edge-api, identity [+ isolated Consent], morpheo, report,
worker [+ isolated Notification, Audit]).

**Gate evidence:** CI run on `b75c17e` — **10/10 jobs green** (Quality gate, the
five service jobs, both frontend jobs, App SPA E2E, dev Hosting deploy).

---

## 1. Definition of Done (§22) — status

| Criterion | Status | Evidence / note |
|-----------|--------|-----------------|
| Implementation finished (through Checkpoint 13.2) | ✅ | Every checkpoint landed CI-green; 13.2 closed at `7ce0c65` (10/10). |
| Format, lint, type-check, tests + coverage gates, build pass | ✅ | CI `b75c17e`: Quality gate + all five service jobs + both frontend jobs green. |
| Affected Docker images build | ⚠️ | Dockerfiles exist for all five services; images build in `deploy.yml` (`build-push`) — but that pipeline is unconfigured, and there is no keyless build-only check in CI yet. **Gap #4.** |
| Migrations reviewed, reversibility stated | ✅ | identity `.down.sql` + `migrations.integration.test.ts` (up/down/idempotent); Alembic for the Python services; §17 policy. |
| API contracts regenerated and committed | ✅ | Zod → JSON-schema, drift-guarded both sides in CI. |
| Security implications reviewed | ✅ | `threat-validation.md` (13 scenarios), least-privilege IAM check (13.1), `dpia.md` (13.2). |
| Logging and metrics included | ✅ | Shared observability redaction pipeline; `monitoring-alert` module + per-env 5xx alert. |
| No secrets committed | ✅ | `.gitignore` covers `tfstate`/`tfvars`/`backend.hcl`; verified on each infra commit. |
| i18n complete for all four locales (es, en, ca, fr) | ⚠️ | Frontend i18n completeness is enforced green in CI (missing keys fail). Morpheo **clinical content** in ca/en/fr is still incomplete. **Gap #10.** |
| READMEs updated | ✅ | All 7 deployables have a README. |
| ADRs recorded | ✅ | 13 ADRs in `docs/adr/`. |
| Acceptance criteria demonstrated with command output | ✅ | Each checkpoint demonstrated via CI + recorded here. |

The **application code** meets the DoD. The remaining items are **operational**
(real environments, pipeline config) and a few **carried-forward deferrals**.

---

## 2. Readiness gaps (numbered)

### A. Operational — must be done before production traffic

1. **staging / production not yet applied.** The Terraform is written and validates,
   but the GCP projects, the GCS state buckets, and billing links do not exist yet;
   `terraform apply` for staging/production is a human action. The 13.3 exit
   ("staging green") is pending this. → `environments/{staging,production}`,
   `backend.hcl.example`.
2. **Promotion pipeline not configured.** Needs the Workload Identity pool/provider,
   the per-environment GitHub Environments with **required reviewers** (the approval
   gates), and the repo/environment variables + secrets. Until `ARTIFACTS_PROJECT_ID`
   is set the pipeline no-ops (green). → `docs/runbooks/promotion-pipeline.md`.
3. **Concrete runtime infrastructure absent from every environment.** Secret Manager
   secrets (TiDB URLs, Brevo, OpenAI), the Cloud Tasks queue (notifications), Pub/Sub
   topics (domain events), and Cloud Scheduler jobs (30-day unclaimed-assessment and
   72 h claim-token cleanup) are not yet declared in Terraform — the modules exist but
   nothing calls them, and dev never had them either. The services cannot fully run
   until these, plus the scoped SA grants (`secretmanager.secretAccessor`, etc.), are
   added. → `modules/environment` (tracked comment).
4. **Docker image build is not verified green anywhere.** It only runs in the
   unconfigured promotion pipeline; a broken Dockerfile would surface at first deploy.
   Recommend a keyless `docker build` (no push) job in CI for changed services on PRs.
   *(I can add this on request.)*
5. **Load test not yet run against a real environment.** The k6 harness and runbook
   are ready, but the alert thresholds (`edge_5xx_threshold`, k6 thresholds) are still
   conservative **placeholders**, not tuned from observed baselines. → `docs/runbooks/load-test.md` results log.
6. **Backup/restore rehearsal not performed.** The procedure is documented; the
   per-logical-database rehearsal record is unfilled. → `docs/runbooks/backup-restore.md` §4.

### B. Structural follow-ups (safe, but recommended)

7. **dev Terraform not unified onto `modules/environment`.** dev is still inline
   (its state is already applied); unify via `moved` blocks, validated against a real
   `terraform plan`, so all three environments share one composition.

### C. Carried-forward deferrals (deliberate; not 13.3 regressions)

8. **DPIA open verification items.** Confirm the TiDB Cloud cluster is EU-region and
   the OpenAI API training-opt-out / ZDR / EU-residency terms on the signed DPAs. →
   `docs/security/dpia.md` §5.
9. **AI rewriting disabled** by `AI_REWRITE_ENABLED` until a human-review mechanism
   exists (build plan §15). Deliberate safety hold, not a bug.
10. **Morpheo clinical content incomplete for ca/en/fr**, plus deferred safety items
    (SAFE-004 escalation signal, SAFE-002 ops pathway). Spanish + English content is in.
11. **Firebase dev Hosting deploy** needs the `FIREBASE_SERVICE_ACCOUNT` secret (the
    job skips without it), and staging/production need their own Firebase projects +
    site targets for frontend promotion.

---

## 3. Phase status

- **Code & CI:** green across all deployables (`b75c17e`, 10/10).
- **13.3 deliverables authored & validated:** staging/production Terraform (fmt +
  validate green), promotion pipeline (valid, no-op until configured), k6 load test +
  runbook. Real `apply`, real deploys, and the real load test are the operator's
  actions with GCP credentials.
- **13.3 exit ("staging green; gaps as a numbered list"):** the gaps above are that
  list. "staging green" becomes true once Gaps #1–#2 are completed and a first
  promotion runs.

This document is updated as each gap closes.
