# Threat validation

Build plan **Checkpoint 13.1**. Every threat scenario in the §21 security baseline
is validated by an **automated or scripted test**. This document is the catalogue:
for each scenario it names the threat, the control that stops it, and the test(s)
that prove the control holds. Exit criterion: *every scenario has a documented pass.*

All cited tests run in CI (`.github/workflows/ci.yml`). Test paths are relative to
the repo root. This is a living document — new attack surface adds a row here with
its proving test.

## Scenario catalogue

| # | Scenario | Control | Proven by |
|---|----------|---------|-----------|
| 1 | Forged Firebase tokens | The edge verifies every ID token with the Firebase Admin SDK before issuing a session. | `services/somnus-edge-api/test/integration/sessions.integration.test.ts` → *rejects a forged token with 401*, *rejects an expired token with 401* |
| 2 | Stolen / tampered session cookies | Signed HttpOnly cookie **and** a server-side session in Firestore; a tampered signature or a missing/invalid server session is rejected. | `services/somnus-edge-api/test/unit/session-guard.test.ts` → *…invalid signature (tampered)*, *…session not found/valid in the store* |
| 3 | CSRF | Double-submit CSRF token (state-changing requests require the header) + `SameSite=Lax` cookie. | `sessions.integration.test.ts` → *rejects a state-changing request with a missing CSRF token (403)*, *the session cookie is HttpOnly, Path=/, SameSite=Lax* |
| 4 | Privilege escalation | Authorization engine: **administrative access is not clinical access**; health data is denied by default. | `services/somnus-identity-service/test/integration/negative-authorization.immutable.test.ts` → *org admin cannot read clinical data automatically*, *support staff denied health data by default* |
| 5 | Cross-organization access | Tenant-scope guard: every query is scoped to the actor's organization. | `negative-authorization.immutable.test.ts` → *cross-organization member access denied*; `services/somnus-identity-service/test/architecture/tenant-scope-guard.test.ts` |
| 6 | Insecure direct object references (IDOR) | Repositories are tenant-scoped (no unscoped `findById`); edge object routes are session-guarded. | `tenant-scope-guard.test.ts`; the cross-org + admin denials above |
| 7 | Expired grants | Membership/grant status and expiry are checked in the authorization engine. | `negative-authorization.immutable.test.ts` → *expired (inactive) membership denied*, *revoked grant denied* |
| 8 | Replayed invitations | Invitation tokens are single-use (consumed on accept). | `negative-authorization.immutable.test.ts` → *invitation token single-use*; `services/somnus-identity-service/test/integration/organization-invitations.repository.test.ts` |
| 9 | Replayed claims | Anonymous→authenticated claim tokens are single-use, expiring, and claimed exactly once under concurrency. | `services/morpheo-service/tests/integration/test_claim.py` → `test_reused_token_is_rejected`, `test_expired_token_cannot_be_claimed`, `test_claim_is_exactly_once_under_concurrency` |
| 10 | Shared report links | Report URLs are short-lived signed URLs with an enforced expiry; object keys are traversal-safe. | `services/somnus-report-service/tests/unit/test_storage.py` → `test_signed_url_carries_a_future_expiry`, `test_expired_url_is_detected`, `test_strict_object_keys_reject_traversal` |
| 11 | Over-permissioned service accounts | One least-privilege service account per service (baseline observability roles only); never `roles/owner`/`roles/editor`. | **`scripts/check-terraform-least-privilege.mjs`** (scans all Terraform; fails on any owner/editor/IAM-admin/wildcard grant), wired into the CI quality gate |
| 12 | Sensitive data in logs | One redaction pipeline in the shared logger (every service routes through it); secrets/health/free-text are never logged. AI audit records carry only hashes. | `packages/observability/src/logger.test.ts` → *redacts known credential keys*, *redacts health fields*, *redacts tokens and health fields from the data section*; `services/somnus-identity-service/test/logger-redaction.e2e.test.ts` (end-to-end through Nest); `services/somnus-report-service/tests/unit/test_llm.py` (*audit carries only hashes, never raw health text*) |
| 13 | Prompt injection against AI wording | Prose-only AI over already-approved text; a forbidden-phrase scanner blocks BLOQUEAR claims on the way out; output is `pending_review`; and AI rewriting is disabled by `AI_REWRITE_ENABLED` until a review mechanism exists. | `services/somnus-report-service/tests/unit/test_rewriter.py` → `test_prompt_injection_cannot_smuggle_a_clinical_claim` (4 vectors), `test_a_bloquear_claim_in_the_ai_output_is_rejected`; `test_render_service.py` (flag-off / flag-on) |

## Notes

- **The negative-authorization suite is immutable** (build plan §20 Checkpoint 6.3):
  once green it is never edited. Scenarios 4–8 lean on it directly; this catalogue
  cites it but does not modify it.
- **Scenario 11** is the one control that had no test before 13.1. The Terraform
  already granted only `baseline_roles` (logging.logWriter, monitoring.metricWriter,
  cloudtrace.agent) to each of the five runtime service accounts, but nothing
  enforced it. The new script makes over-provisioning a build failure.
- **Scenario 13** — the residual paraphrase gap in the literal scanner is documented
  and accepted (`test_residual_risk_a_paraphrased_claim_is_not_caught…`), and AI
  rewriting is disabled by flag until a human-review mechanism exists (§15), so the
  gap is not reachable in production. See `services/somnus-report-service/README.md`.
- Firestore/emulator- and MySQL/TiDB-backed tests run against the emulators / a real
  database in CI, per build plan §19.

## Not yet covered

The following §21 baseline items are validated in later Phase 13 checkpoints, not
here: database TLS, backup/restore, incident-response runbook, and the DPIA
(Checkpoint 13.2); staging/production IAM hardening and load/alerting (13.3).
