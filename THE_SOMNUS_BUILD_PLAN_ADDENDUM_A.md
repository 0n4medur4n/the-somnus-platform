# The Somnus Platform — Build Plan Addendum A: Registration Flows & Admin Console

**Document type:** Addendum to THE_SOMNUS_PLATFORM_BUILD_PLAN.md (v3). Same rules, same session protocol, same precedence: the build plan governs unless this addendum explicitly amends it.
**Adds:** Phase 14 (registration flows) and Phase 15 (admin console).
**Also resolves:** the deferred human-review mechanism for AI-rewritten content (Checkpoint 11.2), which lives inside the admin console.

---

# A1. Registration decisions (per product, per role)

The identity model from Phase 6 already supports every pattern below. No new identity concepts are introduced; this section only decides which pattern each product uses.

| Who                                                                                                                                 | Product             | How they get in                                                                                               | Gate before full access                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individual adult                                                                                                                    | Morpheo             | Self-registration via magic link (existing)                                                                   | Age ≥ 18 confirmed at registration; health-data consent at first assessment (existing)                                                                         |
| Parent / guardian                                                                                                                   | Morpheo (Kids flow) | Self-registration as an adult, then selects the guardian role                                                 | Guardianship confirmation + minor age band; the minor never has an account                                                                                     |
| Professional (Morpheo Pro)                                                                                                          | Morpheo             | Self-registration, then requests professional status                                                          | `professional_verification_case` reviewed and approved by a `professional_verifier` in the admin console; until approved, the account behaves as an individual |
| Researcher / clinician                                                                                                              | Nox                 | **Invitation only**, issued by an organization admin (`organization_invitations`)                             | Organization membership active + role assigned by the org admin; no open signup path exists for Nox                                                            |
| Organization owner                                                                                                                  | Nox / Morpheo Pro   | Created by a platform admin in the admin console **or** by a verified professional requesting an organization | Platform admin approval of the organization                                                                                                                    |
| Internal staff (`support_agent`, `professional_verifier`, `clinical_governance_reviewer`, `platform_admin`, `platform_super_admin`) | Admin console       | **Never self-registered.** Assigned only by `platform_super_admin` in the admin console                       | Immutable negative test from 6.3 already forbids self-assignment; extend it to cover the admin routes                                                          |

Rules that hold across all rows:

- The magic link remains the single authentication mechanism (Firebase authenticates; Somnus authorizes). Roles are never inferred from the email domain.
- Registration is one flow with a role branch, not four separate forms. Step 1: name, locale. Step 2: "I am… an adult / a parent or guardian / a healthcare professional". Step 3 varies by branch. Consent purposes stay separate checkboxes (never combined), per §13.
- A professional who self-registers is a normal individual until verified. The verification queue is the only way to become a professional.
- Nox has no public registration page. Its entry point is the invitation email. An invitation is single-use and expires (existing behavior).
- Minors never register. Every pediatric interaction is through a guardian account with the guardian role, in the Morpheo Kids flow.

# A2. Admin console scope

## A2.1 Placement

- A **separate SPA**, `apps/somnus-admin`, on its own Firebase Hosting site. Not a section of `somnus-app`. Reasons: smaller consumer bundle, isolated attack surface, separate deploy cadence, and the option to restrict it later (IP allowlist, SSO) without touching the consumer app.
- Admin routes are served by `somnus-edge-api` under `/admin/v1/*`, behind the existing session cookie plus a role guard that rejects any request whose session does not carry an internal role. No new public service is introduced.
- Every admin action emits an audit event (`admin.<entity>.<action>.v1`) consumed by the existing audit module. There is no admin action without an audit record.

## A2.2 Capability matrix by internal role

| Capability                                                     | support_agent | professional_verifier | clinical_governance_reviewer | platform_admin             | platform_super_admin       |
| -------------------------------------------------------------- | ------------- | --------------------- | ---------------------------- | -------------------------- | -------------------------- |
| Search users, view account status/metadata                     | ✓             | ✓                     | –                            | ✓                          | ✓                          |
| Suspend / reactivate account                                   | –             | –                     | –                            | ✓                          | ✓                          |
| Process deletion requests                                      | –             | –                     | –                            | ✓                          | ✓                          |
| Professional verification queue (approve/reject)               | –             | ✓                     | –                            | ✓                          | ✓                          |
| Organizations: create, approve, view members                   | –             | –                     | –                            | ✓                          | ✓                          |
| Assign internal roles                                          | –             | –                     | –                            | –                          | ✓                          |
| AI content review queue (`pending_review` → approve/reject)    | –             | –                     | ✓                            | –                          | ✓                          |
| Statistics dashboards (aggregate, from BigQuery)               | ✓             | –                     | ✓                            | ✓                          | ✓                          |
| Audit log viewer (from `somnus_audit`)                         | –             | –                     | ✓                            | ✓                          | ✓                          |
| Consent records viewer (per user, metadata only)               | ✓             | –                     | –                            | ✓                          | ✓                          |
| **Break-glass: view an individual's clinical answers/results** | –             | –                     | ✓ (justification required)   | ✓ (justification required) | ✓ (justification required) |
| System health (service status, queue depths, error rates)      | –             | –                     | –                            | ✓                          | ✓                          |

## A2.3 Data access policy (amends nothing; makes explicit what §11 already implies)

Administrative access and clinical access remain different things. "Full access" for platform admins means full **operational** access: every user, every organization, every statistic, every log, every queue. It does not mean default visibility of an individual person's health answers.

**Break-glass access** is how an admin reaches individual clinical data when genuinely needed (support escalation, safety incident, legal request):

1. The admin opens the record and is stopped by a justification prompt (free text, minimum length, category selector: support / safety / legal / other).
2. On submit, the data is shown for that session only.
3. An immutable audit event records who, which record, when, the justification, and the category. This event is visible in the audit viewer to `platform_super_admin` and `clinical_governance_reviewer`.
4. Break-glass usage appears as a metric on the statistics dashboard (count per admin per month), so abuse is visible, not hidden.

Statistics are built exclusively from the privacy-safe BigQuery export (§9): no names, emails, answers, free text, or tokens. The dashboard cannot be used to reconstruct an individual.

Audit logs shown in the console are the redacted records from `somnus_audit`. If a raw log line would contain health data, it does not exist in that store by design (§5.7); the console cannot display what was never stored.

## A2.4 Statistics dashboard (first version)

Aggregate only, by day/week/month, filterable by locale and product:

- Registrations by role branch; verification requests opened / approved / rejected; median time to verification.
- Assessments started / completed / claimed; drop-off by state-machine step; distribution of L-levels (L0…L4) as counts, never linked to users.
- Reports generated; PDF downloads; notification delivery success/failure; dead-letter counts.
- Organizations: count, active members, invitations pending/accepted/expired.
- Break-glass access count per admin.
- Cost telemetry passthrough (Cloud Run request counts, cold-start counts) if already exported.

---

# A3. Phase 14 — Registration flows

**Checkpoint 14.1 — Role-branched registration in the SPA.**
Extend the existing post-magic-link registration step: name + locale, then role selection (adult / guardian / professional), then branch-specific fields. Adult: age confirmation (≥ 18). Guardian: guardianship confirmation + minor age band (from the Morpheo role definitions, § 14a). Professional: profile fields + "request verification" creating a `professional_verification_case` with status `pending`. Consent purposes as separate checkboxes; the health-data consent stays at first assessment (unchanged). All four locales.
_Tests:_ unit tests per branch; contract tests against the identity endpoints; E2E for each branch in es and ca; **negative:** a self-declared professional gets individual permissions until verified (assert via `/internal/v1/authorization/check`); a minor age at the adult branch is rejected; a guardian cannot skip the guardianship confirmation.
_Exit:_ three branches green end-to-end against the live dev stack.

**Checkpoint 14.2 — Nox invitation-only entry.**
No Nox signup page. Invitation email (existing template) links to an accept flow that, for a new email, runs the magic link then registration with the role branch locked to professional and the organization membership pre-attached from the invitation. Expired/used invitations show a clear error, never a fallback to open registration.
_Tests:_ accept flow new vs existing user; expired and reused invitation rejected; **negative:** no route in the SPA or edge allows creating a Nox membership without a valid invitation or an admin action (architectural test over the route table).
_Exit:_ quality gate green; route-table test green.

**Checkpoint 14.3 — Registration audit and metrics.**
Emit `identity.registration.completed.v1` with role branch (no PII beyond the opaque user id); wire the BigQuery privacy-safe export for registration and verification funnel metrics.
_Tests:_ redaction test on the export; funnel numbers reconcile with a seeded dataset.
_Exit:_ dashboard data source ready for Phase 15.

# A4. Phase 15 — Admin console

**Checkpoint 15.1 — Admin app shell and gate.**
`apps/somnus-admin` (Vite + React + TS, same stack and i18n as `somnus-app`), separate Hosting site. Login via the same magic link; after session exchange, the app calls `/admin/v1/me`; if the session carries no internal role, the app shows nothing but a denial screen. Edge: `/admin/v1/*` router with the role guard; every handler emits an admin audit event.
_Tests:_ **negative first:** a session with only external roles gets 403 on every `/admin/v1/*` route (parametrized over the route table); an internal role gets 200 only on the capabilities its row in A2.2 allows; every admin call produces exactly one audit event (test asserts the count).
_Exit:_ denial screen and gate green; audit events verified.

**Checkpoint 15.2 — Users, organizations, verification queue.**
User search and detail (metadata only), suspend/reactivate, deletion-request processing; organization list/create/approve, members view; professional verification queue with approve/reject and reason. Role assignment screen for `platform_super_admin` only.
_Tests:_ capability matrix enforced per role (parametrized); **immutable negative from 6.3 extended:** self-assignment of privileged roles through the admin routes is rejected; approving a verification flips the authorization decision (assert via `/internal/v1/authorization/check` before/after).
_Exit:_ a real professional goes from `pending` to verified through the console and gains professional permissions, proven end-to-end.

**Checkpoint 15.3 — AI content review queue (closes the 11.2 deferral).**
Persist `pending_review` items (new table in `somnus_reporting`: item id, report id, prompt-template version, model id, input hash, output hash, candidate text, status, reviewer, decision timestamp, reason). Queue screen for `clinical_governance_reviewer`: side-by-side deterministic text vs candidate, approve/reject with reason. Only approved text becomes eligible for rendering. `AI_REWRITE_ENABLED` stays **off** in this checkpoint; the queue is built and tested against seeded items. Turning the flag on is a separate, explicit decision after the clinical lead has used the queue.
_Tests:_ only `clinical_governance_reviewer` / `platform_super_admin` reach the queue; a rejected item can never be rendered; an approved item carries reviewer identity and timestamp; the forbidden-phrase scanner still runs on the candidate before it is even shown to the reviewer.
_Exit:_ review workflow proven with seeded items; flag still off; README of report-service updated from "deferred" to "review mechanism built; enabling requires clinical sign-off".

**Checkpoint 15.4 — Statistics and audit viewer.**
Dashboards from A2.4 reading the BigQuery export; audit log viewer over `somnus_audit` with filters (actor, entity, action, date) and export to CSV for `platform_super_admin`.
_Tests:_ dashboard queries run against the seeded export; **redaction:** the viewer cannot display any field outside the redacted schema (schema-level test); export excludes forbidden fields.
_Exit:_ dashboards render real dev-environment numbers.

**Checkpoint 15.5 — Break-glass access.**
Justification prompt, session-scoped reveal, immutable audit event with category and justification, break-glass counter on the dashboard.
_Tests:_ reveal impossible without justification; justification below minimum length rejected; audit event contains category + justification + record id; the counter increments; **negative:** `support_agent` and `professional_verifier` never see the reveal control.
_Exit:_ one break-glass access performed in dev and visible in both the audit viewer and the dashboard.

---

# A5. Decisions required before Phase 14 starts

1. Confirm Nox is invitation-only through organizations (no open signup, no manual per-user admin creation).
2. Confirm professionals self-register and are verified by a `professional_verifier`, rather than being created by an admin.
3. Confirm the break-glass model for individual clinical data (A2.3) as the meaning of "full access" — or state explicitly that platform admins see individual health data by default, which must then be recorded in the DPIA.
4. Who holds `platform_super_admin` at launch (one named person, ideally two).
5. Whether the admin console must also be available in all four locales at launch, or es/en only (internal tool).

# The Somnus Platform — Build Plan Addendum B: Reference Corpus Management

**Document type:** Addendum to THE_SOMNUS_PLATFORM_BUILD_PLAN.md (v3) and Addendum A. Same rules, same session protocol, same precedence.
**Adds:** Phase 16 — an admin-managed reference corpus that grounds report wording, with a hard separation from the clinical artifacts.
**Depends on:** Checkpoint 11.3 (embeddings + TiDB vector search), Phase 15 (admin console, capability matrix, audit).

---

# B1. The distinction this phase exists to preserve

Two kinds of material can back a Morpheo report. They are governed differently and must never share a storage path, a screen, or a version number.

|                           | **Clinical sources (SRC-01…SRC-15)**                                                      | **Reference corpus (this phase)**                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| What it is                | The evidence base behind specific safety rules                                            | Supporting literature and educational material used to ground plain-language explanation |
| Where it lives            | `morpheo_workflows_v1.json`, versioned in the repo                                        | `somnus_content`, managed at runtime                                                     |
| Who changes it            | Clinical lead, via artifact edit + `content_version` bump + commit + deploy               | `platform_super_admin` **only**, via the admin console                                   |
| Touches the decision path | Yes — a rule cites its SRC                                                                | **Never** (§14b boundary applies unchanged)                                              |
| Reproducibility guarantee | A result stamped `content_version 1.3` always means the same rules and the same citations | A result records `corpus_version`; the corpus is append-and-retire, never destructive    |

**The rule this phase must not break:** nothing an admin does in the console may alter which rule fires, which L-level is assigned, which modules route, or which SRC a rule cites. The corpus can only change _how a already-decided result is worded and what supporting material is cited alongside it_.

Adding a new SRC-xx is still an artifact change, not a console action. If the clinical lead wants a new source to back a rule, the path is unchanged: author it, update the artifact, bump `content_version`, commit, deploy.

# B2. Sequencing note

`AI_REWRITE_ENABLED` is still off, pending clinical sign-off after the review queue (Checkpoint 15.3) has been used. This phase builds the corpus that AI wording would ground in. That ordering is deliberate — the corpus should be populated and reviewed _before_ the flag is ever flipped, not after. Nothing in this phase changes the flag or its default.

# B2a. The two indexes, and when each is written

There are two vector indexes, in two different logical databases, written at two different moments by two different actors. Conflating them is the failure this phase must not produce.

|              | **Index A — clinical sources**                                                          | **Index B — reference corpus**        |
| ------------ | --------------------------------------------------------------------------------------- | ------------------------------------- |
| Database     | `somnus_reporting`                                                                      | `somnus_content`                      |
| Contents     | The fifteen SRC entries, embedded from `citation + use` only (Checkpoint 11.3, Stage 3) | Admin-added documents, per this phase |
| Written by   | The `SourceIndexer` batch job                                                           | The admin console, on publish         |
| Triggered by | A `content_version` bump in the Morpheo artifact                                        | A human action in the console         |
| Governed by  | The clinical artifact                                                                   | `rights_status` + corpus versioning   |

## B2a.1 — When Index A is (re)built

The fifteen SRC entries are not indexed continuously and never on service boot. With minimum instances at zero, boot happens constantly; embedding on boot would hammer the OpenAI API and produce nondeterministic index state.

`SourceIndexer` runs as an explicitly invoked batch job, same operational shape as the bootstrap script from Addendum A §A5.4:

- **Trigger:** a `content_version` bump in `morpheo_workflows_v1.json`, run as a documented deploy step, never automatically.
- **Idempotency:** keyed on `(content_version, src_id, text_hash)`. Re-running for an unchanged source is a no-op — it does not re-embed, does not re-write, does not cost a call. Only a source whose `citation` or `use` actually changed is re-embedded.
- **All-or-nothing:** the existing count-mismatch abort from Stage 3 stands. A partially indexed corpus is never persisted.
- **Retention of prior versions:** an SRC embedding is stamped with the `content_version` that produced it. Older vectors are retained, not overwritten, so a report generated under an earlier `content_version` can still resolve what it was grounded in.
- **Documented in the runbook** alongside the migration steps, with the explicit note that it must never be wired into automatic deploy or startup.

## B2a.2 — Prerequisite to verify before starting

Checkpoint 11.3 Stage 3 delivered the embedding adapter and `SourceIndexer`. **Stage 4 — the `VectorStore`, scoped retrieval at render time, and the determinism proof — was scoped but may not have been completed** before work moved to Phase 14. Confirm its status before starting Phase 16; if Stage 4 is still open, finish it first, because Checkpoint 16.4 extends exactly that retrieval path rather than replacing it.

# B3. Data model (`somnus_content`)

```text
reference_documents
  id, title, citation, source_type, locale, status (draft | published | retired),
  rights_status, rights_evidence, added_by, added_at, reviewed_by, reviewed_at,
  retired_at, retired_reason, corpus_version_added, corpus_version_retired

reference_document_chunks
  id, document_id, chunk_index, text, embedding (vector), embedded_at,
  embedding_model, embedding_dimensions

reference_document_scopes
  document_id, scope_type (module | safety_rule | clinical_source | general), scope_key
  -- e.g. module INS, safety_rule SAFE-006, clinical_source SRC-05, or general

corpus_versions
  version, created_at, created_by, changelog
```

Design rules:

- **Append and retire, never delete.** Retiring a document stops it being retrieved but keeps the row and its `corpus_version_retired`, so a report stamped with an older `corpus_version` remains explainable.
- **Scoped retrieval, not free-for-all.** Every document declares which modules or safety rules it is relevant to. Retrieval for a given report is restricted to the scopes that report's deterministic result actually activated. A document scoped to `BRE` can never surface in a report that only routed to `INS`. `general` scope exists but should be rare and is flagged as such in the UI.
- **Locale matters.** A document is stored per locale. Grounding for a Spanish report retrieves Spanish-locale documents; falling back to another locale is a deliberate, logged decision, not a silent default.
- **Embeddings via the existing provider abstraction only** — `text-embedding-3-large`, through the same adapter from Checkpoint 11.3. No new provider path, no direct SDK calls.

## B3.1 — Enriching a clinical source from the console

`scope_type = clinical_source` is how an admin adds depth to one of the fifteen SRC entries without touching the artifact. The split:

**Stays in the artifact, never console-editable:** which SRC exist, their identifier, their `citation`, their one-line `use`, and which safety rules cite them. These are what the deterministic engine stamps on a result, so they are artifact-governed and version-bound.

**Console-managed, layered on top:** additional material scoped to that SRC — a longer summary, extracted key passages, the full text where `rights_status` permits, a locale-specific rendering. These enrich what the wording step can ground in; they never change what the rule decided or which SRC it cited.

At render time, a report that fired a rule citing SRC-05 retrieves:

1. the SRC-05 base entry from Index A (artifact-governed, always present), and
2. any `published`, locale-matching, `clinical_source`-scoped enrichment for SRC-05 from Index B (may be empty).

A missing or empty enrichment degrades the richness of the explanation and nothing else. **The citation itself always resolves from Index A**, so an empty Index B can never produce a report with a missing or wrong citation — a test asserts exactly this.

The console makes the boundary visible: an SRC's identifier, citation, `use` and citing rules render read-only with a note that they come from the clinical artifact, and only the enrichment panel is editable.

# B4. Rights gate (blocking, not advisory)

`rights_status` is a required field and a document cannot move from `draft` to `published` without it. Allowed values:

- `own_document` — authored by The Somnus (e.g. the internal validation protocol)
- `open_access` — publicly licensed; `rights_evidence` records the licence (CC-BY, government publication, open guideline, etc.) and the URL
- `licensed` — held under an institutional subscription or purchased licence; `rights_evidence` records what licence and who holds it
- `citation_only` — the platform stores the citation and an abstract-length summary only, never the full text; the chunker enforces a hard character cap for this status

The console shows a plain-language warning on `licensed` and `citation_only`, and the README states that several of the platform's clinical sources are paywalled journal articles and cannot be ingested in full text without confirmed rights.

**No document reaches the embedding API before `rights_status` is set.** A test proves this, because the failure mode — quietly uploading a paywalled article's full text to a third-party API — is a legal problem, not a bug.

# B5. Phase 16 checkpoints

**Checkpoint 16.0 — Index A lifecycle (the fifteen sources).**
Confirm Checkpoint 11.3 Stage 4 status first (§B2a.2) and finish it if open. Then make `SourceIndexer` re-runnable per §B2a.1: idempotency keyed on `(content_version, src_id, text_hash)`, prior-version vectors retained not overwritten, invoked explicitly, documented in the deploy runbook with the never-on-boot note.
_Tests:_ re-running for an unchanged `content_version` performs zero embedding calls (assert at the adapter boundary, not by timing); changing one source's `use` re-embeds that source only; a simulated partial failure persists nothing; vectors from an earlier `content_version` remain resolvable.
_Exit:_ quality gate green; runbook updated.

**Checkpoint 16.1 — Corpus storage and versioning.**
Migrations for the §B3 model in `somnus_content` (reversible per §17). `corpus_version` created and bumped on every publish/retire, with a changelog. Repository layer. No console, no embedding yet.
_Tests:_ migration up/down; retire preserves the row and stamps `corpus_version_retired`; a report referencing an older `corpus_version` can still resolve which documents were live at that version.
_Exit:_ quality gate green.

**Checkpoint 16.2 — Rights gate and chunking.**
Rights model per §B4; chunker with a per-status cap (`citation_only` hard-capped); draft→published transition blocked without `rights_status`.
_Tests:_ publish rejected with rights unset, parametrized over every status; `citation_only` text exceeding the cap is rejected, not silently truncated; **a document without `rights_status` can never reach the embedding adapter** (assert at the adapter boundary, not just the UI).
_Exit:_ quality gate green.

**Checkpoint 16.3 — Admin console: corpus management.**
Screen restricted to `platform_super_admin` **only**. No other internal role reaches it, `clinical_governance_reviewer` and `platform_admin` included. This is a new capability in the A2.2 matrix with a single ✓, the same shape as internal role assignment — deliberately the narrowest gate in the platform, because a published corpus document is what an AI wording step grounds in. Add, edit, publish, retire; scope selection (module / safety rule / clinical source / general); locale; rights declaration; list and search. Includes the per-SRC enrichment view from §B3.1: the fifteen sources listed with their artifact-owned fields rendered read-only, and an editable enrichment panel beneath each. Every action emits the standard admin audit event. i18n es/en for the console, matching Phase 15.
_Tests:_ capability matrix extended for the new routes, parametrized over every internal and external role, same pattern as 15.1–15.5; **every role except `platform_super_admin` gets 403, `clinical_governance_reviewer` and `platform_admin` included**; an actor holding every other capability but not this one is still refused; retire is reachable, delete is not (no destructive path exists in the UI or the API); **no console route can write an SRC's identifier, citation, `use` or citing rules** — assert at the API boundary, not just by the field being read-only in the UI.
_Exit:_ a document goes draft → published → retired through the real console, audited at each step; an SRC enrichment is added and the artifact-owned fields are provably untouched.

**Checkpoint 16.4 — Embedding and two-index scoped retrieval.**
Publish triggers chunking and embedding via the Checkpoint 11.3 adapter. Retrieval at report-render time merges both indexes per §B3.1: Index A resolves the SRC the rule cited, Index B adds any published, locale-matching enrichment scoped to that SRC, plus material scoped to the modules and safety rules the deterministic result activated.
_Tests:_ **determinism proof, same shape as 11.3** — with Index B empty, fully populated, returning wrong results, or throwing, the L-level and routes are byte-identical; **the citation always resolves from Index A even with Index B completely empty or failing**; scope isolation (a `BRE`-scoped document never surfaces in an `INS`-only report; an `SRC-05`-scoped enrichment never surfaces in a report that cited only `SRC-10`); locale isolation; **no PII, no health free-text, and no assessment data are ever sent to the embedding API** (only approved corpus text is embedded; assert at the adapter boundary).
_Exit:_ grounding attaches correctly scoped material from both indexes; determinism proof green.

**Checkpoint 16.5 — Corpus provenance in the report.**
Every generated report records which `corpus_version` grounded it and which documents were retrieved. Visible in the AI content review queue (15.3), so a reviewer judging candidate wording can see what it was grounded in.
_Tests:_ provenance recorded and immutable; the review queue surfaces it; a retired document still resolves for an older report's provenance record.
_Exit:_ a seeded report shows its corpus provenance end-to-end in the review queue.

# B6. Decisions required before Phase 16 starts

1. **Confirm the split in B1** — clinical sources stay artifact-only, the reference corpus is console-managed. If the clinical lead wants SRC-xx editable from the console instead, that is a different and much larger decision about reproducibility and must be taken explicitly, not by default.
2. **Rights for the existing thirteen external sources** — which are open access, which are held under an institutional licence, which must stay `citation_only`. This is the open question already raised with the clinical lead and it blocks ingesting those specific documents, though not building the phase.
3. **File upload or structured text entry?** This addendum assumes structured text plus optional attachment. Full PDF ingestion with layout-aware chunking is materially more work and should be its own decision.
4. **Who reviews a corpus addition? — DECIDED.** Only `platform_super_admin` can add, edit, publish or retire. No separate review gate: the single-role restriction is the control. Consequence to keep in view: the clinical lead cannot add clinical reference material without holding `platform_super_admin`, which also carries internal role assignment. If that becomes a bottleneck, the narrower fix is to split the capability in two — `clinical_governance_reviewer` may create and edit drafts, `platform_super_admin` alone may publish — rather than widening the publish gate.
5. **Second `platform_super_admin`.** Addendum A §A5.4 recommends two holders and only one exists today. With corpus management now gated behind this single role, that recommendation stops being housekeeping: one unavailable person blocks all corpus work.
