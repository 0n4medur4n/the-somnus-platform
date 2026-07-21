# The Somnus — AI Prompt Playbook v2

**Companion to:** THE_SOMNUS_PLATFORM_BUILD_PLAN.md (v2)
**Purpose:** the exact prompt sequence for the AI coding agent. One prompt per checkpoint. Every prompt forces the agent to load the build plan first, so context is never assumed.

## How to use

1. Put the **Standard Rules** block below into the agent's persistent project context (CLAUDE.md, system prompt, or equivalent). If your tool has no persistent context, prepend it to every prompt.
2. Run prompts strictly in order. One prompt = one session = one checkpoint.
3. Review the agent's exit report against the checkpoint's *Tests* and *Exit* criteria in the build plan before issuing the next prompt.
4. If criteria fail, re-run the same prompt with the failure report appended. Never advance on red.
5. Never let the agent continue past STOP.

---

## Standard Rules (persistent context)

```text
You are implementing The Somnus platform.

MANDATORY FIRST ACTION of every session, before any other step:
read THE_SOMNUS_PLATFORM_BUILD_PLAN.md in full, then re-read the section(s)
named in the current prompt. The build plan is the single source of truth.
If anything in your training knowledge, a library default, or a previous
session conflicts with the build plan, the build plan wins.

Also read before coding: the root README, every ADR relevant to the task,
and the README of every service you will touch.

Non-negotiable rules (summarized from the build plan; the plan's full text governs):
- Deployable map: 2 static frontends on Firebase Hosting (Astro marketing,
  Vite+React SPA) + 5 Cloud Run services (edge-api, identity incl. isolated
  Consent module, morpheo, report, worker incl. isolated Notification and
  Audit modules). Never add or split deployables.
- Minimum instances = 0 everywhere. Never add warm-up mechanisms beyond the
  ones pre-approved in build plan §2.
- Zod 4 is the single source of truth for contracts; OpenAPI is generated,
  never hand-written. Contracts live in packages/api-contracts before
  endpoints are implemented.
- Stack is pinned in build plan §3: Node 24 LTS, pnpm 10, NestJS 11 +
  Fastify 5, Drizzle, nestjs-zod; Python 3.13, FastAPI, SQLAlchemy 2.0 sync
  + PyMySQL, Alembic, uv; WeasyPrint; Brevo; GPT-5.6 via the OpenAI API
  behind the provider-abstraction module. No substitutions.
- i18n: es, en, ca, fr. Default es. No hardcoded user-facing strings.
  Missing keys fail CI.
- Never access another service's or isolated module's database, tables, or
  repositories. Isolated modules communicate only via their public interface.
- Verify package versions and peers before installing; reject
  alpha/beta/rc/canary/nightly releases.
- Preserve strict TypeScript, Biome, Ruff, mypy settings; never weaken them.
- Never log passwords, tokens, cookies, health data, or secrets.
- LLMs never score, flag, diagnose, or decide urgency; they only rephrase
  approved structured results (build plan §15).
- Do not implement functionality from future phases or checkpoints.
- Negative tests are immutable once green.
- Never claim a command passed without executing it.

Session protocol (build plan §23):
BEFORE: inspect repo, restate objective, list files to change, list and
justify dependencies, state boundary and security implications. Wait for
approval on architectural changes.
AFTER: run the full quality gate, report exact outputs, warnings, and unmet
criteria. Then STOP and wait for approval.
```

---

## Prompt 0.1 — Environment baseline

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §20 Phase 0,
Checkpoint 0.1.

Execute Checkpoint 0.1 exactly as specified: verify every required tool at
its pinned version and create docs/environment-baseline.md.

If any tool is missing or under version, list the exact remediation step
and STOP without proceeding.

Exit criteria are those of Checkpoint 0.1. STOP and report.
```

## Prompt 1.1 — Workspace and quality gate

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §6 (repository
structure), §18 (dependency policy), and §20 Phase 1, Checkpoint 1.1.

Execute Checkpoint 1.1: monorepo, workspace, strict TypeScript, Biome,
Vitest, directory tree exactly as §6, docker-compose.dev.yml (MySQL 8 +
Firebase emulators), justfile with dev-up / dev-down / ci / seed.

No services, no Firebase code, no database schemas, no frontend code yet.

Exit criteria are those of Checkpoint 1.1, including `just ci` green from a
clean clone. STOP and report files created, versions installed, and command
outputs.
```

## Prompt 1.2 — ADRs and CI

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §2, §3, and §20
Phase 1, Checkpoint 1.2.

Execute Checkpoint 1.2: create ADRs 0001–0012 with the titles listed in the
checkpoint, each summarizing the corresponding build-plan decision in one
page maximum, and the minimal GitHub Actions workflow.

Exit criteria are those of Checkpoint 1.2 (CI green on the initial PR).
STOP and report.
```

## Prompt 2.1 — config, errors, observability

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §7 (shared-package
rules), §19 (testing standards), and §20 Phase 2, Checkpoint 2.1.

Execute Checkpoint 2.1 for packages/config, packages/errors,
packages/observability, including OpenTelemetry wiring with a no-op local
exporter and the redaction test that proves forbidden fields never appear
in log output.

Exit criteria are those of Checkpoint 2.1 (≥80% coverage per package, no
imports from services/). STOP and report.
```

## Prompt 2.2 — api-contracts, cloud-run-client, i18n, design-system

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.3 (i18n), §16–§17
(API and event standards), and §20 Phase 2, Checkpoint 2.2.

Execute Checkpoint 2.2. The i18n completeness check must demonstrably fail
on a missing key (include the test that asserts the failure). The event
envelope must match §17 exactly.

Exit criteria are those of Checkpoint 2.2. STOP and report.
```

## Prompt 3.1 — NestJS template (identity shell)

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.4, §16, and §20
Phase 3, Checkpoint 3.1.

Execute Checkpoint 3.1: scaffold somnus-identity-service as the reference
NestJS template. nestjs-zod for validation; OpenAPI generated from Zod to
schemas/openapi/ via an npm script; health/version endpoints; behavioral
rules; multi-stage non-root Dockerfile; template-cloning README.

No identity domain logic yet.

Exit criteria are those of Checkpoint 3.1. STOP and report.
```

## Prompt 4.1 — Python template (Morpheo shell)

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.5, §18, and §20
Phase 4, Checkpoint 4.1.

Execute Checkpoint 4.1: scaffold morpheo-service as the reference Python
template with the exact dependency list (PyMySQL, sync SQLAlchemy engine;
no pandas/numpy/ML/langchain), the required structure, health/version
endpoints, Alembic against somnus_morpheo, empty initial migration,
multi-stage non-root Dockerfile.

No assessment logic yet.

Exit criteria are those of Checkpoint 4.1. STOP and report.
```

## Prompt 5.1 — Terraform dev

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §2 (cost policy),
§3.8, and §20 Phase 5, Checkpoint 5.1.

Execute Checkpoint 5.1: Terraform modules and the dev environment,
including Firebase Hosting sites for both frontends, one least-privilege
service account per Cloud Run service, min instances 0, region
europe-west3, budget alerts, and docs/runbooks/deploy-dev.md.

staging/ and production/ directories exist but stay empty.

Exit criteria are those of Checkpoint 5.1. STOP and report the terraform
plan summary.
```

## Prompt 6.1 — Identity data layer

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §8, §12, §19, and
§20 Phase 6, Checkpoint 6.1.

Execute Checkpoint 6.1: Drizzle schemas and reversible migrations for the
§12 tables, UUIDv7 identifiers, and a repository layer where every
tenant-sensitive method requires an explicit organization or user scope.
Include the migration up/down test and the guard against unscoped tenant
queries.

Exit criteria are those of Checkpoint 6.1. STOP and report.
```

## Prompt 6.2 — Identity domain and API

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §11, §16, and §20
Phase 6, Checkpoint 6.2.

Execute Checkpoint 6.2: contracts in packages/api-contracts first, then the
endpoints listed in the checkpoint, including
POST /internal/v1/authorization/check with the exact decision shape.
Unit-test every reasonCode path.

Sessions endpoints remain stubs until Phase 8.

Exit criteria are those of Checkpoint 6.2 (≥90% coverage on authorization
domain code). STOP and report.
```

## Prompt 6.3 — Negative authorization suite

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §11 and §20 Phase 6,
Checkpoint 6.3.

Execute Checkpoint 6.3: implement all ten negative authorization tests
listed in the checkpoint. All must pass. Mark the suite immutable (comment
header + CI protection note in the README).

Exit criteria are those of Checkpoint 6.3. STOP and report.
```

## Prompt 7.1 — Consent module

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.4 (consent module
isolation), §13, and §20 Phase 7, Checkpoint 7.1.

Execute Checkpoint 7.1: the consent module inside somnus-identity-service
with its own logical database somnus_consent, own migrations, own
repositories; the five APIs; the two events; separate consent purposes.
Include the architectural isolation test and the test proving withdrawal
immediately fails the internal check.

Exit criteria are those of Checkpoint 7.1. STOP and report.
```

## Prompt 8.1 — Edge API sessions and hardening

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.3, §10, and §20
Phase 8, Checkpoint 8.1.

Execute Checkpoint 8.1: clone the NestJS template into somnus-edge-api;
Firebase token verification via the emulator; session cookie
creation/clearing with the required attributes; CSRF; strict CORS for the
two Hosting origins; rate limiting; size limits; correlation propagation.
Include the negative tests: forged token, expired token, CSRF rejection,
rate-limit behavior, revoked session.

Exit criteria are those of Checkpoint 8.1 (full login round-trip green
against the docker-compose stack). STOP and report.
```

## Prompt 8.2 — Edge API composition

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.3, §16, §19
(contract tests), and §20 Phase 8, Checkpoint 8.2.

Execute Checkpoint 8.2: internal OIDC clients via packages/cloud-run-client,
/v1/me composition, consent proxying, error normalization, and the
architectural test proving this service has no TiDB connection. Contract
tests edge ↔ identity/consent.

Exit criteria are those of Checkpoint 8.2. STOP and report.
```

## Prompt 9.1 — Application SPA

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.2, §3.3, §5.2,
§10, and §20 Phase 9, Checkpoint 9.1.

Execute Checkpoint 9.1: the Vite + React SPA with the pinned libraries,
four locales via i18next, the listed routes, Firebase email-link auth via
the emulator exchanged for the edge session cookie, the accessibility
baseline, and the test asserting no tokens in browser storage. Playwright
E2E for the golden path, run in es and in ca.

Exit criteria are those of Checkpoint 9.1 (E2E green; Lighthouse
accessibility ≥95 on login and profile). STOP and report.
```

## Prompt 9.2 — Marketing site

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.1, §4, §5.1, and
§20 Phase 9, Checkpoint 9.2.

Execute Checkpoint 9.2: the Astro static marketing site, localized in the
four locales with hreflang, legal pages rendered from the versioned legal
documents, links into the SPA, Firebase Hosting configuration for both
sites with CI deploy previews.

Exit criteria are those of Checkpoint 9.2 (both frontends deploy to dev
Hosting from CI). STOP and report.
```

## Prompt 10.1 — Morpheo rule engine

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.5, §14, §15, §19,
and §20 Phase 10, Checkpoint 10.1.

Execute Checkpoint 10.1: the pure-domain rule engine (definitions,
versioned localized questions, deterministic scoring, safety flags,
orientation rules) with zero framework dependencies, five rule versions
recorded on every output, and the exhaustive test suite described in the
checkpoint, including property-based tests.

This is required to reach ≥95% coverage. Do not touch persistence or HTTP
in this session.

Exit criteria are those of Checkpoint 10.1. STOP and report.
```

## Prompt 10.2 — Morpheo persistence and anonymous flow

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §14 (including
retention), §17, and §20 Phase 10, Checkpoint 10.2.

Execute Checkpoint 10.2: Alembic migrations, the full anonymous flow with
the exactly-once claim (72h single-use tokens), immutable snapshots, the
two Morpheo events, and the TTL query for the worker. Include the
concurrency test proving exactly-once claiming under parallel attempts.

Exit criteria are those of Checkpoint 10.2. STOP and report.
```

## Prompt 10.3 — Morpheo web integration

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.3, §5.5, and §20
Phase 10, Checkpoint 10.3.

Execute Checkpoint 10.3: edge routes proxying Morpheo and the SPA
assessment flow (anonymous test, preliminary summary, authenticate, claim,
result), with localized questions. Playwright E2E in es and ca, plus the
double-claim and expired-token paths and the accessibility pass.

Exit criteria are those of Checkpoint 10.3. STOP and report.
```

## Prompt 11.1 — Report rendering

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.6, §9 (storage),
and §20 Phase 11, Checkpoint 11.1.

Execute Checkpoint 11.1: deterministic report rendering from the structured
Morpheo payload — versioned templates, immutable metadata, HTML, WeasyPrint
PDF, four locales, private Cloud Storage with signed URLs via the edge.
Golden-file tests per template version and locale.

The service must never recalculate or alter results (include the test).

Exit criteria are those of Checkpoint 11.1. STOP and report.
```

## Prompt 11.2 — Controlled AI wording

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.6, §15, and §20
Phase 11, Checkpoint 11.2.

Execute Checkpoint 11.2: the provider-abstraction module with the OpenAI
adapter (GPT-5.6), configuration-driven model and templates, the
pending_review gate, full §15 logging, and the prompt-injection test
proving hostile content in structured fields cannot alter safety flags or
introduce clinical claims.

Exit criteria are those of Checkpoint 11.2. STOP and report.
```

## Prompt 12.1 — Notifications

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.7, §5.7, and §20
Phase 12, Checkpoint 12.1.

Execute Checkpoint 12.1: somnus-worker from the NestJS template with the
isolated notification module — Cloud Tasks consumer, Brevo adapter
(mocked in tests), localized templates in four locales, idempotency,
retries, dead-letter handling, delivery status. Include the test asserting
emails contain secure links and no health details.

Exit criteria are those of Checkpoint 12.1. STOP and report.
```

## Prompt 12.2 — Audit and scheduled jobs

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §5.7, §9 (BigQuery
restrictions), §14 (retention), and §20 Phase 12, Checkpoint 12.2.

Execute Checkpoint 12.2: the isolated audit module (normalize, persist,
privacy-safe BigQuery export with the redaction test) and the scheduled
jobs (30-day unclaimed-assessment cleanup, 72h token cleanup) with
time-controlled tests. Verify audit trails exist for the Phase 9/10 E2E
flows.

Exit criteria are those of Checkpoint 12.2. STOP and report.
```

## Prompt 13.1 — Threat validation

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §21 and §20 Phase 13,
Checkpoint 13.1.

Execute Checkpoint 13.1: implement every listed threat scenario as an
automated or scripted test and document results in
docs/security/threat-validation.md.

Exit criteria: every scenario has a documented pass. STOP and report any
scenario that cannot be automated, with the manual procedure written out.
```

## Prompt 13.2 — Compliance and operations

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §3.6 (AI provider
data handling), §14 (retention), §21, and §20 Phase 13, Checkpoint 13.2.

Execute Checkpoint 13.2: draft docs/security/dpia.md with the full data
inventory, flows, legal bases, retention, processor list (GCP, Firebase,
Brevo, OpenAI with residency and retention terms verified, and the
Gemini/Vertex fallback recorded), and mitigations. Perform and document the
backup/restore rehearsal per logical database. Write the incident-response
and rollback runbooks. Verify the account-deletion workflow end to end.

Flag clearly any statement in the DPIA that requires human/legal
confirmation rather than technical verification.

Exit criteria are those of Checkpoint 13.2. STOP and report.
```

## Prompt 13.3 — Staging, load, production readiness

```text
Read THE_SOMNUS_PLATFORM_BUILD_PLAN.md, then focus on §2 (cost policy),
§20 Phase 13, Checkpoint 13.3, and §22.

Execute Checkpoint 13.3: Terraform staging and production (min instances 0
everywhere), the promotion pipeline, the load test of the public path with
cold-start percentiles recorded in docs/runbooks/load-test.md, alert
thresholds set from observed baselines, and the final Definition-of-Done
sweep across all deployables.

Exit criteria: staging deploy green; readiness gaps reported as a numbered
list, or an explicit statement that there are none. STOP and report.
```

---

## Reviewer checklist (use at every STOP)

1. Did the agent state that it read the build plan and the named sections? Spot-check one detail.
2. Did it run every quality command it claims, with real output shown?
3. New dependencies: stable, justified, pinned in the lockfile?
4. Migrations: reversible, or documented irreversible with recovery path?
5. New endpoints: contract in packages/api-contracts first, OpenAPI regenerated and committed?
6. Any log near auth, consent, or Morpheo: could it leak a token, cookie, or health field?
7. Any cross-boundary import (service→service or into an isolated module)? Reject immediately.
8. Negative authorization tests untouched and green?
9. All user-facing strings in locale files, all four locales complete?
10. Anything from a future phase or checkpoint? Revert it.
11. Coverage gates met (90% domain / 80% overall / 95% rule engine)?
