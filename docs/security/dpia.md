# Data Protection Impact Assessment (DPIA)

Build plan **Checkpoint 13.2** and **§21** ("DPIA maintained as a living
document"). The Somnus platform processes health-adjacent personal data (sleep
orientation), so a DPIA is required. This document is the living record: data
inventory, flows, legal bases, retention, processors, and mitigations. It is
revised whenever a new data category, processor, or flow is introduced.

- **Owner:** Data Protection lead (platform owner until a DPO is appointed).
- **Region:** all compute and primary storage in `europe-west3` (EU). Any
  processor outside the EEA is called out below with its transfer basis.
- **Last reviewed:** 2026-08-21 (initial). Review on every processor change and
  at least annually.

---

## 1. Data inventory

Each logical database is owned by exactly one service or isolated module and is
reached only through that owner's public interface (ADR 0003, ADR 0010). No FK
or query ever crosses a database boundary.

| Store | Owner | Personal data held | Special category? |
|-------|-------|--------------------|-------------------|
| `somnus_identity` | identity-service | Email, name, locale, org membership, professional credentials, access grants, account-status history, deletion requests | No (contact/identity) |
| `somnus_consent` | Consent module (isolated) | Consent receipts + withdrawals (purpose, document version, timestamp) | No |
| `somnus_morpheo` | morpheo-service | Assessment sessions, per-answer responses, deterministic result snapshots, single-use claim tokens | **Yes — health-adjacent (sleep orientation), Art. 9** |
| `somnus_reporting` | report-service | Report render records + metadata pointing at generated PDFs/HTML | **Yes — derived from health data** |
| `somnus_content` | report/morpheo content | Curated clinical artifacts (safety rules, templates, sources) — **no personal data** | No |
| `somnus_notifications` | Notification module (isolated) | Notification log (recipient reference, template, status) | No (contact) |
| `somnus_audit` | Audit module (isolated) | Normalized audit events — **hashes and identifiers only, never raw health text or free text** | No |
| Firebase Auth | Firebase (Google) | Authentication identity (Firebase UID, sign-in method) | No |
| Firestore | edge-api | Short-lived server-side sessions, idempotency/workflow state, claim-token coordination — **not a source of truth** | No |
| Cloud Storage (GCS) | report-service | Generated report artifacts (PDF/HTML), reached only via short-lived signed URLs | **Yes — derived from health data** |

**Data subjects:** anonymous assessment takers, registered individuals,
verified professionals, and organization administrators.

---

## 2. Data flows

1. **Anonymous assessment** — browser → edge-api → morpheo-service. A session is
   created, answers are validated and stored incrementally, safety re-evaluation
   runs per answer, results are computed **deterministically** (no LLM scoring,
   §15), and a preliminary summary is returned. No identity is attached.
2. **Claim** — after Firebase sign-in, the anonymous assessment is claimed
   **exactly once** with a single-use 72 h token, producing an immutable snapshot
   bound to the now-known user, and an async report request is emitted.
3. **Report** — worker → report-service renders the approved structured result to
   HTML/PDF, stored in GCS; access is via short-lived signed URLs only. Optional
   LLM prose is **prose-only over already-approved text** and is currently
   **disabled** by `AI_REWRITE_ENABLED` (see §5).
4. **Notification** — worker's Notification module sends transactional email via
   Brevo (claim confirmations, report-ready).
5. **Audit** — every service emits audit events; the Audit module normalizes and
   persists them in `somnus_audit` (hashes only) and exports **privacy-safe,
   redacted** events to BigQuery.

All internal Cloud Run services are private (ADR 0008); only edge-api and the two
static frontends are public. Database connections use TLS.

---

## 3. Legal bases (GDPR Art. 6 / Art. 9)

| Processing | Art. 6 basis | Art. 9 condition |
|------------|--------------|------------------|
| Account & identity management | Art. 6(1)(b) contract | — |
| Sleep-orientation assessment & results | Art. 6(1)(a) consent | Art. 9(2)(a) **explicit consent** |
| Report generation & delivery | Art. 6(1)(b) contract / (a) consent | Art. 9(2)(a) explicit consent |
| Transactional email | Art. 6(1)(b) contract | — |
| Security & audit logging | Art. 6(1)(f) legitimate interest / (c) legal obligation | — |

Consent for the health-adjacent processing is captured as an explicit consent
receipt (`somnus_consent`) tied to the accepted document version; withdrawal is
recorded and honoured.

---

## 4. Retention & erasure

| Data | Retention | Enforced by |
|------|-----------|-------------|
| Unclaimed anonymous assessments | **30 days** | Cloud Scheduler → worker → Morpheo deletion endpoint |
| Claim tokens | **72 hours** | Scheduled claim-token cleanup |
| Generated reports (GCS) | Per privacy policy; signed URLs short-lived | report-service storage policy |
| Audit events (`somnus_audit`) | **Retained** past account deletion (security / legal obligation) — hashes only, no raw health | Documented legal basis, §21 |
| Registered account data | Until account deletion / erasure request | Account-deletion workflow (§6) |

Both TTL policies (30 days, 72 h) are stated in the public privacy policy.

---

## 5. Processors and international transfers

| Processor | Role | Location / transfer basis | Residency & retention notes |
|-----------|------|---------------------------|-----------------------------|
| **Google Cloud (GCP)** | Compute + storage: Cloud Run, Cloud Storage, Cloud Tasks, Pub/Sub, Cloud Scheduler, Secret Manager, BigQuery | `europe-west3` (EU) | Data stays in-region; Google DPA + SCCs. |
| **Firebase (Google)** | Hosting, Authentication, Firestore | EU project (`the-somnuss`); Google DPA | Auth identity + short-lived state only. |
| **TiDB Cloud** | Managed MySQL — the seven logical databases | **Must be EU-region cluster; TLS enforced** | ⚠️ Confirm the cluster region is EU on the signed DPA before production. |
| **Brevo** (Sendinblue) | Transactional email (Notification module) | France (EU) | EU processor; DPA in place. No health content in emails. |
| **OpenAI** | GPT-5.6 (prose rewrite) + `text-embedding-3-large` (clinical retrieval), via the report-service provider-abstraction module | US — **transfer basis: SCCs + signed DPA** | Record on the signed DPA: (a) **API data is not used for training by default**; (b) API abuse-monitoring retention (≤30 days) or **Zero Data Retention** if granted; (c) EU data-residency option if eligible. ⚠️ **Verify these against the signed OpenAI DPA.** |

**Fallback decision (recorded, per §3/§21):** if OpenAI's residency or retention
terms cannot be met for EU health-adjacent data, switch the report-service LLM
adapter to **Gemini on Vertex AI with EU region pinning**. The provider
abstraction (`report-service/infrastructure/llm/`) exists specifically so this
swap needs no business-logic change. Note: OpenAI embeddings and GPT-5.6 are not
available through Vertex, so a switch also re-hosts embeddings on a Vertex model.

**Open verification items** (living-document actions):
- [ ] Confirm TiDB Cloud cluster is EU-region and TLS-only on the DPA.
- [ ] Confirm OpenAI API training-opt-out, retention (ZDR?), and EU residency on the signed DPA.

---

## 6. Account-deletion workflow (verified end-to-end)

Right to erasure (Art. 17). `DELETE /v1/me` on edge-api orchestrates erasure
across every owning service; each service erases **its own** data — no cross-DB
access:

1. **Morpheo** — `POST /internal/v1/maintenance/user-assessments/delete` erases
   the user's claimed assessments (sessions, answers, snapshots, tokens).
2. **Identity** — `DELETE /v1/me` erases the account in one transaction
   (user, profiles, memberships, invitations, access grants, credentials,
   verification cases, role assignments, session revocations, status history,
   deletion requests) **and** the isolated Consent module erases its receipts +
   withdrawals via `ConsentService.eraseUser`.
3. **Session** — the edge revokes the session so the cookie dies immediately.

The **audit trail (`somnus_audit`) is deliberately retained** (§21, security /
legal obligation) and holds only hashes/identifiers — no raw health data — so
retention does not re-expose personal content.

**Proven by** (all in CI):
- `services/morpheo-service/tests/integration/test_maintenance.py` → *delete a user's claimed assessment*
- `services/somnus-identity-service/test/integration/account-deletion.repository.test.ts` → *erases personal data, retains the audit trail, leaves others intact*
- `services/somnus-identity-service/test/integration/consent/consent-erasure.test.ts` → *deletes a user's consent receipts and withdrawals*
- `services/somnus-edge-api/test/unit/composition-services.test.ts` → *erases morpheo assessments, deletes the identity account, then revokes the session*

---

## 7. Risk mitigations

| Risk | Mitigation | Reference |
|------|-----------|-----------|
| Unauthorized access to health data | Default-deny authorization (administrative ≠ clinical access); tenant-scoped repositories | negative-authorization immutable suite; `docs/security/threat-validation.md` #4–7 |
| Health data leaking into logs | One redaction pipeline in the shared logger; audit records carry only hashes | threat-validation #12 |
| LLM inventing or altering clinical content | LLMs never score/flag/diagnose; prose-only over approved text; forbidden-phrase scanner; output `pending_review`; **`AI_REWRITE_ENABLED` off** until human review exists | §15; threat-validation #13 |
| Token replay (claim / invitation / report link) | Single-use, expiring, exactly-once-under-concurrency tokens; short-lived signed URLs | threat-validation #8–10 |
| Over-permissioned infrastructure | One least-privilege service account per service; owner/editor/IAM-admin/wildcard grants fail CI | `scripts/check-terraform-least-privilege.mjs`; threat-validation #11 |
| Cross-service data access | Service-owned data; isolated modules reachable only via public interface | ADR 0003, ADR 0010 |
| Data loss | Managed backups + point-in-time recovery per logical database; rehearsed restore | `docs/runbooks/backup-restore.md` |
| Bad deploy / migration | Reversible migrations; Cloud Run revision rollback | `docs/runbooks/rollback.md` |

---

## 8. Residual risk

- **Paraphrased clinical claim** slipping past the literal forbidden-phrase
  scanner is documented and accepted; AI rewriting is disabled until a human
  review mechanism lands (threat-validation #13, notes).
- **OpenAI / TiDB residency** items in §5 remain open until the signed DPAs are
  confirmed; the Vertex fallback is the standing mitigation.

This DPIA is revisited whenever those items resolve or a new processor/flow is added.
