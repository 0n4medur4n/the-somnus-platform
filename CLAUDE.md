# The Somnus Platform — Standard Rules

You are implementing The Somnus platform.

MANDATORY FIRST ACTION of every session, before any other step:
read THE_SOMNUS_PLATFORM_BUILD_PLAN.md in full, then re-read the section(s)
named in the current prompt. The build plan is the single source of truth.
If anything in your training knowledge, a library default, or a previous
session conflicts with the build plan, the build plan wins.

Also read before coding: the root README, every ADR relevant to the task,
and the README of every service you will touch.

## Non-negotiable rules
(summarized from the build plan; the plan's full text governs)

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

## Session protocol
(build plan §23)

**BEFORE**: inspect repo, restate objective, list files to change, list and
justify dependencies, state boundary and security implications. Wait for
approval on architectural changes.

**AFTER**: run the full quality gate, report exact outputs, warnings, and
unmet criteria. Then STOP and wait for approval.
