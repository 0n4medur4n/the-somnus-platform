# The Somnus Platform — Build Plan v2

**Document type:** AI-executable engineering plan
**Version:** 2.0 (supersedes v1 entirely)
**Language:** English
**Architecture:** Static frontends on Firebase Hosting + independent Cloud Run services
**Primary goal:** Build The Somnus platform incrementally, securely, and cheaply, without creating a distributed monolith
**Initial product scope:** Platform foundation, authentication, profiles, organizations, roles, consent, and Morpheo
**Out of scope:** Nox, Siren, The Somnus Therapy, native mobile applications, wearables, payments, and external clinical integrations

---

# 1. Purpose

This document defines how an AI coding agent must build The Somnus platform.

The platform must be created incrementally. The AI must never attempt to implement the entire system in a single iteration.

The build order is:

1. Prepare the development environment (Phase 0).
2. Create the repository and quality foundation (Phase 1).
3. Create shared packages (Phase 2).
4. Create the NestJS and Python service templates (Phases 3–4).
5. Create development infrastructure (Phase 5).
6. Create identity and authorization (Phase 6).
7. Create consent (Phase 7).
8. Create the edge API (Phase 8).
9. Create the frontends (Phase 9).
10. Create Morpheo (Phase 10).
11. Create reporting, notifications, and audit (Phases 11–12).
12. Harden and deploy (Phase 13).

Every phase contains numbered **Development Checkpoints**. Each checkpoint has explicit test requirements and exit criteria. The AI must stop at every checkpoint and wait for approval. Phases and checkpoints must never be skipped or reordered.

---

# 2. Core Architecture Decision

The Somnus uses:

- **Static frontends** (marketing site and application SPA) built at CI time and served from Firebase Hosting through its CDN. No frontend servers, no frontend cold starts, near-zero hosting cost.
- **Microservices** based on bounded business contexts, deployed as independent Cloud Run services.

Each Cloud Run service has:

- an independent Docker image;
- an independent service account with minimum IAM permissions;
- independent environment variables and secrets;
- independent database credentials and migrations;
- independent health checks, tests, and deployment lifecycle.

## Deployable map

```text
Internet
   |
   +--> Firebase Hosting
   |        +--> somnus-marketing   (Astro, static)
   |        +--> somnus-app         (Vite + React SPA)
   |
   +--> somnus-edge-api             (NestJS, Cloud Run, public)
              |
              +--> somnus-identity-service   (NestJS, Cloud Run, private)
              |        includes the Consent module (isolated)
              +--> morpheo-service           (Python, Cloud Run, private)
              +--> somnus-report-service     (Python, Cloud Run, private)
              +--> somnus-worker             (NestJS, Cloud Run, private)
                       includes Notification + Audit modules (isolated)
```

Five Cloud Run services total. Consent and the two worker concerns are **isolated modules**, not separate deployables: each has its own logical database, its own migration history, its own repository layer, and communicates with sibling modules only through the module's public service interface. Extracting any of them into a dedicated service later must be a deployment change, not a rewrite.

## Cost policy

Cost takes priority over latency at this stage:

- **All Cloud Run services run with minimum instances = 0 in every environment, including production.** Cold starts are an accepted trade-off.
- Cold-start mitigations that cost nothing are mandatory: slim images (multi-stage, distroless or alpine runtime), lazy initialization of non-critical clients, no eager warm-up of database pools beyond one connection, fast frameworks (Fastify, FastAPI).
- Optional and pre-approved if login latency becomes a real complaint: a Cloud Scheduler job pinging `somnus-edge-api` every 10 minutes during 07:00–24:00 Europe/Madrid. Nothing else may be added to fight cold starts without a new decision.
- Budget alerts are configured in every environment from Phase 5.

## Repository decision

The project is a monorepo. A monorepo does not mean a monolith. Every service must remain independently buildable, testable, deployable, scalable, and replaceable.

---

# 3. Technology Decisions

All choices below are pinned. The AI must not substitute alternatives.

## 3.1 Marketing site — `apps/somnus-marketing`

- Astro (static output, no SSR adapter);
- Tailwind CSS;
- TypeScript;
- deployed to Firebase Hosting.

Purpose: public marketing pages, product pages, pricing, blog, legal pages (rendered from the versioned legal documents), SEO. No authenticated functionality. React islands only where a page genuinely needs interactivity.

## 3.2 Application SPA — `apps/somnus-app`

- Vite;
- React;
- TypeScript;
- Tailwind CSS;
- `react-router` (stable) for routing;
- `@tanstack/react-query` (stable) for server state;
- `react-hook-form` + Zod resolvers for forms;
- `i18next` + `react-i18next` for internationalization;
- Vitest + React Testing Library for unit/component tests;
- Playwright for end-to-end tests;
- deployed to Firebase Hosting (separate site/target from marketing).

Purpose: everything authenticated — individual application, professional portal, organization administration, assessments, results, settings. The SPA talks only to `somnus-edge-api`.

Restrictions: no database access, no secrets in the browser, no trusted authorization decisions client-side, no direct calls to internal services.

## 3.3 Internationalization

The platform is multilingual from the first commit.

- Locales: **`es`, `en`, `ca`, `fr`.** Default `es`.
- All user-facing strings (SPA, marketing, emails, reports, error messages surfaced to users) live in locale files. Hardcoded user-facing strings are a lint-level defect.
- The user's locale is stored in the profile, carried in the session context, and passed to the report service so reports render in the user's language.
- Assessment question text is versioned content per locale inside Morpheo's definition tables, not UI locale files.
- Translation completeness is CI-checked: a missing key in any locale fails the build.

## 3.4 Transactional backend services (TypeScript)

- Node.js 24 LTS;
- NestJS 11 with Fastify 5 via `@nestjs/platform-fastify`;
- TypeScript strict;
- **Zod 4 as the single source of truth for all contracts.** Validation uses `nestjs-zod`. The OpenAPI specification is generated from the Zod schemas (via nestjs-zod's OpenAPI integration with `@nestjs/swagger`) and committed to `schemas/openapi/` by a CI step. Zod and OpenAPI are complementary: Zod validates at runtime, OpenAPI documents the same contract. Hand-written OpenAPI files are forbidden;
- Drizzle ORM + `mysql2`;
- Vitest;
- Biome;
- pnpm 10.

Used for: edge API/BFF, identity, authorization, users, profiles, professionals, organizations, memberships, invitations, consent, notifications, audit.

## 3.5 Python services

- Python 3.13;
- FastAPI;
- Pydantic 2 + pydantic-settings;
- SQLAlchemy 2.0, **synchronous engine with `PyMySQL`** (one driver, no async driver mixed in);
- Alembic;
- pytest, pytest-cov;
- Ruff, mypy;
- HTTPX;
- `uv`.

Used for: Morpheo (deterministic assessment rules, questionnaire scoring, safety-signal calculation), report generation, data processing, statistical analysis, controlled AI integrations, future ML.

Python must not be introduced into identity, users, roles, organizations, or ordinary transactional CRUD without a documented reason.

## 3.6 AI provider

- **Primary LLM: GPT-5.6 via the OpenAI API.** Note for the record: GPT-5.6 is served by OpenAI directly; it is not available through Vertex AI (Vertex offers OpenAI's open-weight gpt-oss models, which are a different product line).
- All LLM calls go through a **provider-abstraction module** inside the report service (`infrastructure/llm/`): a single interface, provider adapters behind it (OpenAI first; a Vertex/Gemini adapter may be added later without touching business logic). Model name, temperature, and prompt-template version are configuration, never hardcoded at call sites.
- EU data handling: the DPIA (§ 21) must record OpenAI's data-residency and retention terms for the API, confirm training-opt-out/ZDR settings, and list OpenAI as a processor. If residency requirements cannot be met, the fallback decision is switching the adapter to Gemini on Vertex AI with EU region pinning.
- The AI restriction model in § 19 applies to every provider identically.

## 3.7 Email

- **Brevo transactional API** for all email delivery, called only from `somnus-worker`.
- Templates are versioned in the repository and localized (es, en, ca, fr).
- Emails contain secure application links, never health details.

## 3.8 Infrastructure

- Google Cloud Run; Artifact Registry; Secret Manager; Cloud IAM; Cloud Tasks; Pub/Sub; Cloud Scheduler; Cloud Storage; Firebase Hosting; Firebase Authentication; Firestore only for approved temporary state; BigQuery for privacy-safe analytics; Terraform; GitHub Actions.
- Region: `europe-west3`. Frequently communicating services stay in the same region.
- Tracing: OpenTelemetry exporting to Cloud Trace, wired once in `packages/observability` (no-op exporter locally).

## 3.9 Primary database

TiDB Cloud with the MySQL protocol. For the MVP, one physical cluster contains multiple logical databases to control cost:

```text
somnus_identity
somnus_consent
somnus_morpheo
somnus_reporting
somnus_notifications
somnus_audit
```

Each logical database has its own database user, password, schema-scoped access, independent migration history, and service-specific pool configuration. Services (and isolated modules) never read or write another database's tables.

Local development uses MySQL 8 in Docker as a TiDB stand-in; the TiDB Cloud dev cluster is used by integration tests in CI.

---

# 4. Brand Foundation

Master brand: **The Somnus**. Initial product: **Morpheo**.

```css
:root {
  --somnus-background: #090d1a;
  --somnus-surface: #141c33;
  --somnus-primary: #437ef7;
  --somnus-text: #e2e8f0;
  --somnus-muted: #64748b;
}
```

Design direction: dark-first, calm, trustworthy, clinical without appearing cold, modern, accessible, suitable for individuals and healthcare professionals. Avoid exaggerated medical claims, emergency-care visuals, excessive animation, low-contrast text, decorative complexity, aggressive color.

Typography: use approved brand fonts only after web licences are confirmed; until then the documented fallback:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Design tokens live in `packages/design-system` and are consumed by both frontends and the report templates.

---

# 5. Deployable Responsibilities

## 5.1 `somnus-marketing` (Firebase Hosting)

Public website, landing pages, pricing, legal pages, SEO, localized in all four locales. Links into the SPA for sign-in. No cookies beyond consent-compliant analytics (if any), no authenticated state.

## 5.2 `somnus-app` (Firebase Hosting)

The authenticated SPA: sign-in and registration screens (Firebase Auth passwordless email link), individual application, professional portal, organization administration, assessment flow, results, settings. Communicates only with `somnus-edge-api`. Session is a secure cookie set by the edge API; the SPA never stores tokens in localStorage.

## 5.3 `somnus-edge-api` (Cloud Run, public)

Public API entry point; Firebase ID-token verification and exchange; server-side session cookies; CSRF; CORS restricted to the Hosting origins; correlation IDs; rate limiting; request-size limits; API composition; authenticated calls to private services; standardized error responses.

Restrictions: no TiDB connection; no Morpheo scoring logic; no duplicated authorization or consent logic. The edge API is a BFF, not a business-domain service.

## 5.4 `somnus-identity-service` (Cloud Run, private)

Platform users; Firebase identity mapping; individual and professional profiles; professional credentials and verification; organizations; locations; memberships; invitations; roles; permissions; access grants; account status; authorization decisions; session-revocation metadata.

**Consent module (isolated):** legal-document versions; consent purposes; consent receipts; withdrawals; professional-data-sharing, marketing, and research consent; consent evidence. Versioned and auditable. Own logical database `somnus_consent`, own migrations, own repositories; identity code reaches consent only through the module's public interface.

## 5.5 `morpheo-service` (Cloud Run, private)

Assessment definitions and versions; localized question definitions; assessment sessions; answers; deterministic questionnaire scoring; safety-signal rules; orientation rules; structured results; anonymous-assessment claim flow; rule versioning; Morpheo audit events.

Restrictions: no password management; no organization management; no identity-database access; no email delivery; no final authorization decisions; no unrestricted LLM decisions. Morpheo receives validated identity and authorization context from the platform.

## 5.6 `somnus-report-service` (Cloud Run, private)

Report templates and versioning; immutable report snapshots; HTML rendering; PDF via **WeasyPrint**; localized output (es, en, ca, fr); optional controlled AI wording through the provider-abstraction module.

It must not recalculate scores, alter safety flags, create diagnoses, invent clinical facts, or prescribe treatments.

## 5.7 `somnus-worker` (Cloud Run, private)

**Notification module (isolated):** Cloud Tasks consumer; Brevo delivery; localized templates; idempotency keys; retries; max attempts; dead-letter handling; delivery status. Logical database `somnus_notifications`.

**Audit module (isolated):** consumes audit events from all services; normalizes and persists audit records; exports privacy-safe analytics events to BigQuery. Logical database `somnus_audit`. It must not become a copy of every service database.

**Scheduled jobs:** unclaimed-assessment cleanup (30-day TTL), expired claim-token cleanup, and future retention jobs, triggered by Cloud Scheduler.

---

# 6. Repository Structure

```text
the-somnus-platform/
├── apps/
│   ├── somnus-marketing/
│   └── somnus-app/
│
├── services/
│   ├── somnus-edge-api/
│   ├── somnus-identity-service/
│   ├── morpheo-service/
│   ├── somnus-report-service/
│   └── somnus-worker/
│
├── packages/
│   ├── api-contracts/
│   ├── cloud-run-client/
│   ├── config/
│   ├── design-system/
│   ├── errors/
│   ├── i18n/
│   ├── observability/
│   ├── test-utils/
│   └── tsconfig/
│
├── schemas/
│   ├── events/
│   ├── json-schema/
│   └── openapi/
│
├── infrastructure/
│   └── terraform/
│       ├── modules/
│       └── environments/
│           ├── dev/
│           ├── staging/
│           └── production/
│
├── docs/
│   ├── adr/
│   ├── api/
│   ├── data/
│   ├── runbooks/
│   └── security/
│
├── scripts/
├── .github/workflows/
├── docker-compose.dev.yml
├── justfile
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── biome.json
├── tsconfig.json
├── .editorconfig
├── .gitignore
├── .nvmrc
├── README.md
└── THE_SOMNUS_PLATFORM_BUILD_PLAN.md   (this document)
```

`packages/i18n` holds the shared locale infrastructure and the CI completeness check; each app holds its own locale files.

---

# 7. Service and Module Ownership Rules

A service or isolated module must never: connect to another's database; import another's repositories; modify another's tables; perform cross-boundary SQL joins; use shared database entities; depend on another's internal code.

Communication happens through: authenticated HTTP APIs; versioned events; Cloud Tasks; Pub/Sub; and, between isolated modules inside one service, the module's public service interface only.

Shared packages may include schemas, error formats, event envelopes, logging utilities, design tokens, API-client utilities, i18n infrastructure, and test utilities. Shared packages must not include business repositories, Morpheo scoring rules, identity authorization rules, cross-service transactions, or shared database models.

---

# 8. Data Architecture

Isolation requirements per logical database: dedicated user, dedicated password, schema-scoped access, independent migration history, separate backup validation, service-specific pool configuration.

Do not rely on: stored procedures; triggers; scheduled database events; cross-service transactions; row-level-security features; direct database access from frontends.

Tenant isolation is explicit in service code. Every tenant-aware repository method receives an organization or user scope:

```typescript
findMembership({ organizationId, membershipId });   // correct
findMembershipById(membershipId);                    // forbidden for tenant data
```

**Migration rollback policy:** every Drizzle/Alembic migration must be reversible, or explicitly documented as irreversible with a stated recovery path, reviewed in the pull request.

**Seed data:** `scripts/seed-dev.ts` plus a Python equivalent create a deterministic development dataset: one organization, one admin, one verified professional, one individual user, one published localized assessment definition. E2E tests depend on this seed.

---

# 9. Temporary State and File Storage

**Firestore** may hold short-lived anonymous-session lookup, temporary workflow state, idempotency coordination, and short-lived claim tokens. It must not become a second source of truth for identity, organization, consent, or assessment records.

**Cloud Storage** holds generated PDF reports, private exports, controlled attachments. Buckets are never public; access uses authenticated endpoints and short-lived signed URLs with strict object naming and expiration.

**BigQuery** holds product analytics, funnel metrics, aggregate operational data, privacy-safe events. Never send: names, email addresses, full questionnaire answers, health-related free text, report content, authentication tokens.

---

# 10. Authentication

Firebase Authentication. Initial methods: passwordless email link; Google sign-in where appropriate. No additional methods in the first phase without a product requirement.

Session flow:

1. The SPA authenticates with Firebase (Auth emulator locally).
2. Firebase returns an ID token.
3. The SPA sends the ID token to `somnus-edge-api`.
4. The edge API verifies the token.
5. The edge API creates a secure server-side session cookie.
6. The identity service maps the Firebase identity to a Somnus user.
7. The SPA uses the session cookie for all subsequent requests. Tokens are never persisted in browser storage.

Cookie requirements: `HttpOnly`; `Secure`; scoped; `SameSite`; revocable; renewed intentionally; excluded from logs. State-changing operations require CSRF protection.

---

# 11. Authorization

Firebase authenticates the person. **The Somnus authorizes the action.** Firebase custom claims are never the primary authorization system. Authorization belongs to `somnus-identity-service`, using: role-based access control; organization-membership checks; professional-verification checks; resource-relationship checks; explicit access grants; status and expiration checks.

## Roles

External: `individual_user`, `professional`, `organization_owner`, `organization_admin`, `professional_manager`, `clinical_supervisor`.
Internal: `support_agent`, `professional_verifier`, `clinical_governance_reviewer`, `platform_admin`, `platform_super_admin`.

Professional specialty (family physician, pediatrician, sleep physician, psychologist, nurse, pharmacist, therapist) is profile information, never an authorization role.

## Access rules

A professional may access an individual's shared information only when all conditions hold: active professional account; completed verification where required; active membership or approved independent context; assigned permission; explicit unexpired, unrevoked access grant or approved assignment; and no withdrawn consent. An organization administrator never automatically receives health data access: administrative access and clinical access are different.

---

# 12. Identity Data Model

```text
users, user_identities, individual_profiles, professional_profiles,
professional_credentials, professional_verification_cases, organizations,
organization_locations, organization_memberships, organization_invitations,
roles, permissions, role_permissions, role_assignments, access_grants,
account_status_history, session_revocations, deletion_requests,
identity_audit_events
```

Every identifier exposed across services is opaque (UUIDv7). Sequential database identifiers are never exposed in external APIs.

---

# 13. Consent Data Model

```text
legal_documents, legal_document_versions, consent_purposes,
consent_receipts, consent_withdrawals, consent_audit_events
```

Never combine legal permissions into one checkbox. Record separately: terms acceptance; privacy-policy acknowledgement; health-data processing; professional sharing; marketing; research participation. Every receipt includes user, purpose, document version, timestamp, action, source, optional organization context, withdrawal status.

---

# 14. Morpheo Data Model

```text
assessment_definitions, assessment_definition_versions,
question_definitions (localized: es, en, ca, fr),
questionnaire_license_records, assessment_sessions, assessment_answers,
score_results, safety_flag_results, orientation_results,
assessment_claim_tokens, assessment_access_links, morpheo_audit_events
```

Morpheo is an assessment and orientation service, never an automated medical-diagnosis engine.

Deterministic (always): questionnaire scoring; answer validation; safety flags; orientation codes; result status; escalation requirements. Every output records: assessment-definition version; question-set version; scoring-rule version; safety-rule version; orientation-rule version; completion timestamp.

**Retention:** unclaimed anonymous assessments are deleted after **30 days** by a scheduled worker job; claim tokens expire after **72 hours**. Both policies are stated in the privacy policy.

---

# 15. Artificial Intelligence Restrictions

An LLM must never: calculate questionnaire scores; determine safety flags; provide a definitive diagnosis; remove an approved warning; prescribe medication; invent symptoms; infer facts absent from the structured data; independently decide clinical urgency.

An LLM may: rewrite approved structured results in plain language; adapt tone to the audience; translate approved content between the four locales; summarize deterministic results; improve readability.

Initially, all AI-generated health-related text requires human review before release (`pending_review` status, not user-visible until approved).

Log per generation: model identifier; template version; prompt-template identifier; structured input hash; response hash; timestamp; review status. Never log unnecessary raw health information.

---

# 16. API Standards

All APIs are versioned under `/v1/`.

Success shape:

```json
{ "data": { "id": "opaque-id" }, "meta": { "correlationId": "uuid" } }
```

Error shape:

```json
{ "error": { "code": "ORGANIZATION_MEMBERSHIP_NOT_FOUND", "message": "The requested membership could not be found.", "correlationId": "uuid", "details": {} } }
```

Never return stack traces, SQL errors, secret values, Firebase tokens, or connection details. Error `message` values shown to users go through i18n on the frontend using the stable `code`.

---

# 17. Event Standards

Versioned envelope:

```json
{
  "eventId": "uuid",
  "eventType": "morpheo.assessment.completed.v1",
  "occurredAt": "2026-01-01T12:00:00.000Z",
  "producer": "morpheo-service",
  "correlationId": "uuid",
  "actor": { "type": "user", "id": "opaque-id" },
  "subject": { "type": "assessment", "id": "opaque-id" },
  "data": {}
}
```

Initial events:

```text
identity.user.created.v1
identity.organization.created.v1
identity.organization.invitation.created.v1
identity.professional.verification.requested.v1
consent.receipt.recorded.v1
consent.receipt.withdrawn.v1
morpheo.assessment.created.v1
morpheo.assessment.completed.v1
report.generation.requested.v1
report.generated.v1
notification.email.requested.v1
```

Events never contain passwords, tokens, cookies, full report bodies, unrestricted free text, or full answer collections.

---

# 18. Dependency Policy

The newest published version is not automatically the correct production version. Use supported runtimes, stable releases only (no alpha/beta/rc/canary/nightly), reproducible lockfiles, deliberate major upgrades.

```text
Node.js 24 LTS · pnpm 10.x · NestJS 11.x · Fastify 5.x · Zod 4.x
TypeScript: stable version validated with NestJS
Python 3.13 · FastAPI latest stable · Pydantic 2.x · SQLAlchemy 2.0.x · Alembic 1.x
```

Before installing, verify:

```bash
pnpm view PACKAGE_NAME version && pnpm view PACKAGE_NAME peerDependencies --json
uv pip index versions PACKAGE_NAME
```

Then: confirm stability, review peers, avoid prerelease tags, install the approved major, update the lockfile, run all tests, record the decision in the PR.

---

# 19. Testing Standards (applies to every checkpoint)

These are the platform-wide rules; each phase's checkpoints add their specific cases.

- **Unit tests** cover pure logic: authorization policies, role evaluation, consent transitions, scoring rules, safety flags, orientation rules, validation, error mapping. Coverage gate: ≥ 90 % lines on `domain/` and rule-engine code, ≥ 80 % overall per package/service. Coverage numbers are enforced in CI, not aspirational.
- **Integration tests** cover repositories against a real MySQL (docker-compose locally, TiDB dev cluster in CI), migrations up **and** down, Firebase adapters (emulator), Cloud Run clients, event publishing, Cloud Tasks handlers, idempotency.
- **Contract tests** validate both sides of every boundary against the generated OpenAPI/Zod contracts: app ↔ edge, edge ↔ identity (incl. consent), edge ↔ morpheo, morpheo ↔ report, report ↔ worker. A provider change that breaks a consumer contract fails CI.
- **E2E tests** (Playwright against the docker-compose stack + seed data) cover the golden paths listed per phase, run headless in CI, and include at least one run per non-default locale (`ca` chosen as the tie-breaker locale since it is the most likely to be forgotten).
- **Negative tests are immutable once green.** Future changes may add negative tests, never weaken or delete them.
- Tests that assert on logs must also assert the **absence** of forbidden fields (tokens, cookies, health data).
- Every bug fixed after a checkpoint gets a regression test in the same PR.

---

# 20. Phases and Development Checkpoints

Each checkpoint ends with the same exit ritual: run the full quality gate (format, lint, typecheck, tests with coverage, build, Docker build for changed services), report exact outputs, then STOP for approval.

## Phase 0 — Local prerequisites

**Checkpoint 0.1 — Environment baseline.**
Install and verify: Git, Node 24 LTS, Corepack, pnpm 10, Python 3.13, uv, Docker, gcloud, Terraform, Firebase CLI. Record everything in `docs/environment-baseline.md` (OS, architecture, versions, date, limitations).
*Exit:* every verification command succeeds at pinned versions.

## Phase 1 — Repository bootstrap

**Checkpoint 1.1 — Workspace and quality gate.**
Repo, pnpm workspace, root `package.json` (strict scripts incl. `ci`), strict `tsconfig.json` (never weakened), Biome, Vitest, `.nvmrc`, `.editorconfig`, `.gitignore`. Directory tree from § 6. `docker-compose.dev.yml` (MySQL 8 + Firebase emulators) and a `justfile` (`dev-up`, `dev-down`, `ci`, `seed`).
*Tests:* a trivial root test proves Vitest wiring; `just ci` green from a clean clone.
*Exit:* lockfile committed; all root commands green.

**Checkpoint 1.2 — ADRs and CI.**
ADRs: 0001 Cloud Run per bounded context; 0002 monorepo/independent deployments; 0003 service-owned data; 0004 NestJS+Fastify; 0005 Python for Morpheo/data; 0006 Firebase auth / Somnus authz; 0007 Morpheo independent; 0008 private internal services; 0009 static frontends on Firebase Hosting (Astro marketing + Vite SPA); 0010 consolidated 5-service map with isolated modules; 0011 pinned technical decisions (Zod-first contracts, PyMySQL, WeasyPrint, Brevo, GPT-5.6 via OpenAI API with provider abstraction, min-instances 0); 0012 four-locale i18n. Minimal GitHub Actions: frozen install, format, lint, typecheck, test, build.
*Exit:* CI green on the initial PR.

## Phase 2 — Shared packages

**Checkpoint 2.1 — config, errors, observability.**
`config`: Zod-validated env, startup failure on invalid config, public/private separation, typed access. `errors`: stable codes, safe public messages, internal metadata, HTTP mapping. `observability`: structured JSON logs (service, env, version, commit, correlation ID, duration), redaction, OpenTelemetry → Cloud Trace (no-op locally).
*Tests:* config rejects each invalid shape; error mapping table-tested; **redaction test proves tokens/cookies/health fields never appear in output**.
*Exit:* every package ≥ 80 % coverage; no imports from `services/`.

**Checkpoint 2.2 — api-contracts, cloud-run-client, i18n, design-system.**
`api-contracts`: Zod v4 request/response schemas, event envelope, pagination, UUIDv7 helpers, shared error schema; zero business logic. `cloud-run-client`: OIDC token acquisition, explicit audience, timeouts, retry policy, correlation propagation, safe error conversion. `i18n`: locale loader, typing for keys, CI completeness check across es/en/ca/fr. `design-system`: brand tokens.
*Tests:* contract schemas round-trip valid/invalid fixtures; client retry/timeout behavior mocked; i18n check fails on a deliberately missing key (test asserts the failure).
*Exit:* quality gate green.

## Phase 3 — NestJS service template

**Checkpoint 3.1 — Identity shell as template.**
Scaffold `somnus-identity-service`: Fastify, nestjs-zod validation, OpenAPI generated to `schemas/openapi/` by script; structure `common/ (errors, filters, guards, interceptors, pipes)`, `config/`, `modules/`, `infrastructure/`; endpoints `GET /health/live`, `GET /health/ready`, `GET /version`; behavior: 0.0.0.0, `PORT` (8080 default), graceful shutdown, correlation interceptor, structured logs, no production stack traces; multi-stage non-root Dockerfile; README documents how to clone the template.
*Tests:* e2e-style tests for health/version; error filter maps a thrown domain error to the § 16 shape; log-shape test with redaction assertion.
*Exit:* boots locally, OpenAPI generates, image builds.

## Phase 4 — Python service template

**Checkpoint 4.1 — Morpheo shell as template.**
`uv init` (3.13); deps: fastapi, uvicorn[standard], pydantic, pydantic-settings, sqlalchemy, alembic, httpx, pymysql; dev: pytest, pytest-asyncio, pytest-cov, ruff, mypy. **Do not install** pandas/numpy/ML/langchain/notebooks. Structure `src/morpheo/{main, api, application, domain, infrastructure, repositories, schemas, settings}` + `tests/{unit,integration,contract}`. Health/version endpoints, same behavioral rules as § 20 Phase 3. Alembic against `somnus_morpheo` (local MySQL), empty initial migration. Multi-stage non-root Dockerfile.
*Tests:* health/version; settings validation failure test; a placeholder pure-function test establishing the `domain/` testing pattern.
*Exit:* ruff format+check, mypy, pytest green; image builds.

## Phase 5 — Development infrastructure

**Checkpoint 5.1 — Terraform dev.**
Modules: project APIs, Artifact Registry, Cloud Run, service accounts (one per service, least privilege), Cloud Run IAM, Secret Manager, Cloud Tasks, Pub/Sub, Cloud Scheduler, Cloud Storage, Firebase Hosting sites (marketing + app), budget alerts, monitoring alerts. Environment `dev` applied; `staging`/`production` directories exist but empty. **Min instances 0 everywhere.** Region `europe-west3`. CI runs `terraform fmt` + `validate` on infra PRs. `docs/runbooks/deploy-dev.md`.
*Exit:* fmt/validate/plan clean for dev; budget alert configured.

## Phase 6 — Identity and authorization MVP

**Checkpoint 6.1 — Data layer.**
Drizzle schemas + reversible migrations for § 12 tables in `somnus_identity`; UUIDv7 everywhere; repository layer where every tenant-sensitive method requires explicit scope.
*Tests:* repository integration tests against MySQL; migration up/down test; a compile-time or lint guard proving unscoped tenant queries cannot be written (pattern documented).
*Exit:* ≥ 80 % coverage on repositories.

**Checkpoint 6.2 — Domain and API.**
Contracts in `packages/api-contracts` first, then endpoints: sessions (stubs until Phase 8), `/v1/me`, profile patch, organizations CRUD, invitations create/accept, members list/patch, verification cases, access grants create/revoke, `POST /internal/v1/authorization/check` returning:

```json
{ "allowed": true, "decisionId": "uuid", "reasonCode": "AUTHORIZED_BY_ACTIVE_ACCESS_GRANT", "constraints": { "organizationId": "opaque-id", "subjectUserId": "opaque-id", "expiresAt": "2026-01-01T00:00:00.000Z" } }
```

*Tests:* unit tests for every reasonCode path of the authorization policy; contract tests against the generated OpenAPI.
*Exit:* ≥ 90 % coverage on authorization domain code.

**Checkpoint 6.3 — Negative authorization suite (immutable).**
Automated tests, all green: org admin cannot read clinical data automatically; inactive professional denied; unverified professional denied where verification required; expired membership denied; revoked grant denied; cross-organization member access denied; self-assignment of privileged roles denied; support staff denied health data by default; invitation token single-use; deleted/suspended user cannot create a session.
*Exit:* suite green and marked immutable.

## Phase 7 — Consent module

**Checkpoint 7.1 — Consent inside identity, fully isolated.**
Drizzle schemas + migrations for § 13 in `somnus_consent`; separate purposes (never one checkbox); APIs: `GET /v1/legal-documents/current`, `POST /v1/consents`, `GET /v1/consents/current`, `POST /v1/consents/:id/withdraw`, `POST /internal/v1/consents/check`; events `consent.receipt.recorded.v1` / `consent.receipt.withdrawn.v1`.
*Tests:* record, withdraw, version supersession, check endpoint; **withdrawal immediately fails the check** (time-sensitive test); an architectural test (dependency-cruiser or equivalent) proving identity code cannot import consent internals.
*Exit:* quality gate green; isolation test green.

## Phase 8 — Edge API

**Checkpoint 8.1 — Sessions and hardening.**
Clone template → `somnus-edge-api` + `@fastify/cookie`, `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`. Firebase ID-token verification (emulator locally); `POST /v1/sessions` exchanges token for HttpOnly/Secure/SameSite cookie; `DELETE /v1/sessions/current` clears and revokes; CSRF on state-changing routes; strict CORS for the two Hosting origins; rate limiting; size limits; correlation propagation.
*Tests:* token exchange happy path; forged/expired token rejected; cookie attribute assertions; CSRF rejection; rate-limit 429 behavior; revoked session rejected.
*Exit:* full login round-trip green against docker-compose stack.

**Checkpoint 8.2 — Composition.**
Internal clients via `packages/cloud-run-client` (OIDC audience per service); `/v1/me` composed from identity; consent routes proxied; error normalization via `packages/errors`; **no TiDB connection in this service** (architectural test).
*Tests:* contract tests edge ↔ identity/consent; error mapping from downstream failures; timeout/retry behavior.
*Exit:* quality gate green.

## Phase 9 — Frontends

**Checkpoint 9.1 — SPA foundation.**
`apps/somnus-app`: Vite + React + TS + Tailwind + react-router + TanStack Query + react-hook-form/Zod + i18next (es/en/ca/fr, default es). Auth screens (Firebase email link via emulator) → session exchange with edge API. Routes: `/login`, `/auth/callback`, `/app`, `/app/profile`, `/app/security`, `/professional`, `/professional/profile`, `/organization`, `/organization/members`, `/organization/invitations`. Accessibility baseline: keyboard navigation, visible focus, semantic headings, labeled forms, error summaries, screen-reader announcements, reduced motion, contrast, no color-only status. No tokens in browser storage (test asserts).
*Tests:* component tests for auth and forms; i18n completeness in CI; Playwright E2E: register, login, edit profile, create organization, invite, accept, logout — once in `es`, once in `ca`.
*Exit:* E2E green; Lighthouse a11y ≥ 95 on login and profile.

**Checkpoint 9.2 — Marketing site.**
`apps/somnus-marketing`: Astro static, localized landing/pricing/legal pages rendered from versioned legal documents, SEO metadata + hreflang for four locales, links into the SPA. Firebase Hosting config with two sites/targets and CI deploy previews.
*Tests:* build-time link check; hreflang/meta snapshot tests; i18n completeness.
*Exit:* both frontends deploy to dev Hosting from CI.

## Phase 10 — Morpheo MVP

**Checkpoint 10.1 — Rule engine (pure domain).**
Assessment definitions, versioned localized questions, deterministic scoring, safety-flag rules, orientation rules as pure functions with zero dependencies on FastAPI/SQLAlchemy/Firebase/HTTP:

```python
result = calculate_assessment_result(definition=definition, answers=answers, rule_version=rule_version)
```

Every output records all five rule versions + timestamp.
*Tests:* exhaustive unit tests: every question type, boundary answers, every safety-flag trigger and non-trigger, version pinning, property-based tests on score monotonicity where applicable. **≥ 95 % coverage on the rule engine.**
*Exit:* the most-tested code in the platform, demonstrably.

**Checkpoint 10.2 — Persistence and anonymous flow.**
Alembic migrations for § 14; anonymous flow: create session → incremental validated answers → deterministic results → preliminary summary → authenticate → claim exactly once (single-use token, 72 h) → immutable snapshot → async report request. Events emitted. TTL query exposed for the worker.
*Tests:* integration tests for the flow; **concurrency test proving exactly-once claim under parallel attempts**; expired/reused token rejected; snapshot immutability (update attempts fail); contract tests against edge expectations.
*Exit:* quality gate green.

**Checkpoint 10.3 — Web integration.**
Edge routes proxying Morpheo; SPA assessment flow: take test anonymously, preliminary summary, authenticate, claim, view result; localized questions render per locale.
*Tests:* Playwright E2E: anonymous completion + claim (es and ca); double-claim rejected; expired token path; accessibility pass on the assessment screens.
*Exit:* golden path green end-to-end locally.

## Phase 11 — Report service

**Checkpoint 11.1 — Deterministic rendering.**
Clone Python template → `somnus-report-service`. Input: structured Morpheo payload (`assessmentId`, `definitionVersion`, `scoreResults`, `safetyFlags`, `orientationCodes`, `completedAt`). Versioned templates; immutable metadata; HTML; PDF via WeasyPrint; localized output es/en/ca/fr; storage in private Cloud Storage; signed URLs via edge. The service never recalculates or alters results.
*Tests:* golden-file test per template version and locale; immutability; template/rule version references present in output; signed-URL expiry.
*Exit:* completed assessment produces HTML + PDF locally.

**Checkpoint 11.2 — Controlled AI wording.**
Provider-abstraction module (`infrastructure/llm/`): interface + OpenAI adapter (GPT-5.6), model/template/temperature from config. AI rewrites approved structured results only; output flagged `pending_review`, never user-visible until approved. Full § 15 logging.
*Tests:* adapter mocked; **prompt-injection test: hostile content in structured fields cannot alter safety flags or add clinical claims** (output validated against an allowlist schema); logging asserts hashes present and raw health text absent; review-gate test (unapproved text never reaches the report endpoint).
*Exit:* quality gate green.

## Phase 12 — Worker

**Checkpoint 12.1 — Notifications.**
`somnus-worker` from the NestJS template; notification module: Cloud Tasks consumer, Brevo adapter, localized templates (4 locales), idempotency keys, retry policy, max attempts, dead-letter handling, delivery status in `somnus_notifications`. Emails carry secure links, never health details (test asserts template content).
*Tests:* idempotent redelivery (same key processed once); dead-letter path; Brevo adapter mocked; locale selection.
*Exit:* invitation and report-ready emails flow locally (mocked Brevo).

**Checkpoint 12.2 — Audit and scheduled jobs.**
Audit module: consume all audit events, normalize, persist in `somnus_audit`, export privacy-safe events to BigQuery (redaction enforced). Scheduled jobs: 30-day unclaimed-assessment cleanup calling Morpheo's deletion endpoint; 72 h claim-token cleanup.
*Tests:* redaction test on BigQuery export (forbidden fields absent); TTL job behavior with time control; audit trail present for every Phase 9/10 E2E flow.
*Exit:* quality gate green; module isolation test green.

## Phase 13 — Hardening and launch readiness

**Checkpoint 13.1 — Threat validation.**
Execute every scenario as an automated or scripted test, documented in `docs/security/threat-validation.md`: forged Firebase tokens; stolen session cookies; CSRF; privilege escalation; cross-organization access; insecure direct object references; expired grants; replayed invitations; replayed claims; shared report links; over-permissioned service accounts; sensitive data in logs; prompt injection against AI wording.
*Exit:* every scenario has a documented pass.

**Checkpoint 13.2 — Compliance and operations.**
`docs/security/dpia.md`: data inventory, flows, legal bases, retention (30-day TTL, 72 h tokens), processors (GCP, Firebase, Brevo, OpenAI — with residency/retention terms verified and the Gemini/Vertex fallback recorded), mitigations. Backup/restore rehearsal per logical database, documented. Incident-response and rollback runbooks. Account-deletion workflow verified end-to-end.
*Exit:* DPIA complete; restore rehearsal documented.

**Checkpoint 13.3 — Staging, load, production readiness.**
Terraform staging + production (min instances 0 per cost policy); promotion pipeline: PR → CI → dev deploy → approved promotion → staging → manual approval → production; only changed services build/deploy. Load test the public path (login, assessment, claim, report download) including cold-start percentiles, recorded in `docs/runbooks/load-test.md`; alert thresholds set from observed baselines (elevated 5xx, failed readiness, pool exhaustion, dead-letter tasks, report failures, auth anomalies, cost spikes). Final Definition-of-Done sweep (§ 22) across all deployables.
*Exit:* staging green; readiness gaps reported as a numbered list or none.

---

# 21. Security Baseline

Least-privilege IAM; one service account per service; private internal Cloud Run; Secret Manager; secure session cookies; CSRF; strict CORS; rate limiting; request-size limits; input validation; output serialization; database TLS; dependency scanning; secret scanning; structured audit logging; data-retention policy; account-deletion workflow; backup/restore procedure; incident-response runbook; **DPIA maintained as a living document**.

---

# 22. Definition of Done

A task, checkpoint, or phase is complete only when: implementation finished; formatting, linting, type checking, tests (with coverage gates), and build pass; affected Docker images build; migrations reviewed (reversibility stated); API contracts regenerated and committed; security implications reviewed; logging and metrics included; no secrets committed; i18n complete for all four locales; READMEs updated; ADRs recorded; acceptance criteria demonstrated with command output.

---

# 23. AI Implementation Protocol

**Before coding:** read this document, the root README, relevant ADRs, and affected service READMEs; inspect the repository; identify the current phase and checkpoint; restate the objective; list files to change; list and justify new dependencies; state data-ownership and security implications. Wait for approval when a change modifies architecture.

**During coding:** smallest coherent change; preserve boundaries; strict typing; validate external input; no speculative abstractions; no premature dependencies; no future-phase work; never weaken tests or compiler settings; never log sensitive data; all user-facing strings through i18n.

**After coding:** run the applicable quality gate —

```bash
pnpm lint && pnpm typecheck && pnpm test:run && pnpm build
uv run ruff format --check . && uv run ruff check . && uv run mypy src && uv run pytest
```

— and report files changed, dependencies added with exact versions, commands executed with real results, warnings, remaining work, and whether the checkpoint's acceptance criteria were met. **Never claim a command passed if it was not executed.** Then STOP.

---

# 24. Permanent Architecture Rules

> Firebase authenticates. The Somnus authorizes.
> Frontends are static: Astro markets, the Vite + React SPA operates.
> NestJS manages transactional platform services. Python manages Morpheo, deterministic data processing, and controlled AI workflows.
> Zod is the single source of truth; OpenAPI is generated, never hand-written.
> Every service and isolated module owns its data.
> Administrative access is not clinical access.
> Morpheo rules decide structured results. AI may explain approved results but may not diagnose.
> Minimum instances are zero; cold starts are the price of runway.
> Four locales, always: es, en, ca, fr.
