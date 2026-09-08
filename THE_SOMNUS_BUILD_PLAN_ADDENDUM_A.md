# The Somnus Platform — Build Plan Addendum A: Registration Flows & Admin Console

**Document type:** Addendum to THE_SOMNUS_PLATFORM_BUILD_PLAN.md (v3). Same rules, same session protocol, same precedence: the build plan governs unless this addendum explicitly amends it.
**Adds:** Phase 14 (registration flows) and Phase 15 (admin console).
**Also resolves:** the deferred human-review mechanism for AI-rewritten content (Checkpoint 11.2), which lives inside the admin console.

---

# A1. Registration decisions (per product, per role)

The identity model from Phase 6 already supports every pattern below. No new identity concepts are introduced; this section only decides which pattern each product uses.

| Who | Product | How they get in | Gate before full access |
|---|---|---|---|
| Individual adult | Morpheo | Self-registration via magic link (existing) | Age ≥ 18 confirmed at registration; health-data consent at first assessment (existing) |
| Parent / guardian | Morpheo (Kids flow) | Self-registration as an adult, then selects the guardian role | Guardianship confirmation + minor age band; the minor never has an account |
| Professional (Morpheo Pro) | Morpheo | Self-registration, then requests professional status | `professional_verification_case` reviewed and approved by a `professional_verifier` in the admin console; until approved, the account behaves as an individual |
| Researcher / clinician | Nox | **Invitation only**, issued by an organization admin (`organization_invitations`) | Organization membership active + role assigned by the org admin; no open signup path exists for Nox |
| Organization owner | Nox / Morpheo Pro | Created by a platform admin in the admin console **or** by a verified professional requesting an organization | Platform admin approval of the organization |
| Internal staff (`support_agent`, `professional_verifier`, `clinical_governance_reviewer`, `platform_admin`, `platform_super_admin`) | Admin console | **Never self-registered.** Assigned only by `platform_super_admin` in the admin console | Immutable negative test from 6.3 already forbids self-assignment; extend it to cover the admin routes |

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

| Capability | support_agent | professional_verifier | clinical_governance_reviewer | platform_admin | platform_super_admin |
|---|---|---|---|---|---|
| Search users, view account status/metadata | ✓ | ✓ | – | ✓ | ✓ |
| Suspend / reactivate account | – | – | – | ✓ | ✓ |
| Process deletion requests | – | – | – | ✓ | ✓ |
| Professional verification queue (approve/reject) | – | ✓ | – | ✓ | ✓ |
| Organizations: create, approve, view members | – | – | – | ✓ | ✓ |
| Assign internal roles | – | – | – | – | ✓ |
| AI content review queue (`pending_review` → approve/reject) | – | – | ✓ | – | ✓ |
| Statistics dashboards (aggregate, from BigQuery) | ✓ | – | ✓ | ✓ | ✓ |
| Audit log viewer (from `somnus_audit`) | – | – | ✓ | ✓ | ✓ |
| Consent records viewer (per user, metadata only) | ✓ | – | – | ✓ | ✓ |
| **Break-glass: view an individual's clinical answers/results** | – | – | ✓ (justification required) | ✓ (justification required) | ✓ (justification required) |
| System health (service status, queue depths, error rates) | – | – | – | ✓ | ✓ |

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
*Tests:* unit tests per branch; contract tests against the identity endpoints; E2E for each branch in es and ca; **negative:** a self-declared professional gets individual permissions until verified (assert via `/internal/v1/authorization/check`); a minor age at the adult branch is rejected; a guardian cannot skip the guardianship confirmation.
*Exit:* three branches green end-to-end against the live dev stack.

**Checkpoint 14.2 — Nox invitation-only entry.**
No Nox signup page. Invitation email (existing template) links to an accept flow that, for a new email, runs the magic link then registration with the role branch locked to professional and the organization membership pre-attached from the invitation. Expired/used invitations show a clear error, never a fallback to open registration.
*Tests:* accept flow new vs existing user; expired and reused invitation rejected; **negative:** no route in the SPA or edge allows creating a Nox membership without a valid invitation or an admin action (architectural test over the route table).
*Exit:* quality gate green; route-table test green.

**Checkpoint 14.3 — Registration audit and metrics.**
Emit `identity.registration.completed.v1` with role branch (no PII beyond the opaque user id); wire the BigQuery privacy-safe export for registration and verification funnel metrics.
*Tests:* redaction test on the export; funnel numbers reconcile with a seeded dataset.
*Exit:* dashboard data source ready for Phase 15.

# A4. Phase 15 — Admin console

**Checkpoint 15.1 — Admin app shell and gate.**
`apps/somnus-admin` (Vite + React + TS, same stack and i18n as `somnus-app`), separate Hosting site. Login via the same magic link; after session exchange, the app calls `/admin/v1/me`; if the session carries no internal role, the app shows nothing but a denial screen. Edge: `/admin/v1/*` router with the role guard; every handler emits an admin audit event.
*Tests:* **negative first:** a session with only external roles gets 403 on every `/admin/v1/*` route (parametrized over the route table); an internal role gets 200 only on the capabilities its row in A2.2 allows; every admin call produces exactly one audit event (test asserts the count).
*Exit:* denial screen and gate green; audit events verified.

**Checkpoint 15.2 — Users, organizations, verification queue.**
User search and detail (metadata only), suspend/reactivate, deletion-request processing; organization list/create/approve, members view; professional verification queue with approve/reject and reason. Role assignment screen for `platform_super_admin` only.
*Tests:* capability matrix enforced per role (parametrized); **immutable negative from 6.3 extended:** self-assignment of privileged roles through the admin routes is rejected; approving a verification flips the authorization decision (assert via `/internal/v1/authorization/check` before/after).
*Exit:* a real professional goes from `pending` to verified through the console and gains professional permissions, proven end-to-end.

**Checkpoint 15.3 — AI content review queue (closes the 11.2 deferral).**
Persist `pending_review` items (new table in `somnus_reporting`: item id, report id, prompt-template version, model id, input hash, output hash, candidate text, status, reviewer, decision timestamp, reason). Queue screen for `clinical_governance_reviewer`: side-by-side deterministic text vs candidate, approve/reject with reason. Only approved text becomes eligible for rendering. `AI_REWRITE_ENABLED` stays **off** in this checkpoint; the queue is built and tested against seeded items. Turning the flag on is a separate, explicit decision after the clinical lead has used the queue.
*Tests:* only `clinical_governance_reviewer` / `platform_super_admin` reach the queue; a rejected item can never be rendered; an approved item carries reviewer identity and timestamp; the forbidden-phrase scanner still runs on the candidate before it is even shown to the reviewer.
*Exit:* review workflow proven with seeded items; flag still off; README of report-service updated from "deferred" to "review mechanism built; enabling requires clinical sign-off".

**Checkpoint 15.4 — Statistics and audit viewer.**
Dashboards from A2.4 reading the BigQuery export; audit log viewer over `somnus_audit` with filters (actor, entity, action, date) and export to CSV for `platform_super_admin`.
*Tests:* dashboard queries run against the seeded export; **redaction:** the viewer cannot display any field outside the redacted schema (schema-level test); export excludes forbidden fields.
*Exit:* dashboards render real dev-environment numbers.

**Checkpoint 15.5 — Break-glass access.**
Justification prompt, session-scoped reveal, immutable audit event with category and justification, break-glass counter on the dashboard.
*Tests:* reveal impossible without justification; justification below minimum length rejected; audit event contains category + justification + record id; the counter increments; **negative:** `support_agent` and `professional_verifier` never see the reveal control.
*Exit:* one break-glass access performed in dev and visible in both the audit viewer and the dashboard.

---

# A5. Decisions required before Phase 14 starts

1. Confirm Nox is invitation-only through organizations (no open signup, no manual per-user admin creation).
2. Confirm professionals self-register and are verified by a `professional_verifier`, rather than being created by an admin.
3. Confirm the break-glass model for individual clinical data (A2.3) as the meaning of "full access" — or state explicitly that platform admins see individual health data by default, which must then be recorded in the DPIA.
4. Who holds `platform_super_admin` at launch (one named person, ideally two).
5. Whether the admin console must also be available in all four locales at launch, or es/en only (internal tool).
