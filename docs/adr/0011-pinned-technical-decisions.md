# ADR 0011 — Pinned technical decisions (Zod-first, PyMySQL sync, WeasyPrint, Brevo, GPT-5.6, min-instances 0)

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §3 (Technology decisions), §18 (Dependency policy), §2 (Cost policy)

## Context

Each library choice below has a long-running failure mode: silent
schema drift, async/sync deadlocks, unreliable fonts, undelivered
emails, accidental PII training, runaway cost. The build plan pins
them so the team does not re-debate them in every phase.

## Decision

The following are pinned and must not be substituted:
- **Contracts:** Zod 4 is the single source of truth. OpenAPI is
  generated from Zod via `nestjs-zod` + `@nestjs/swagger` and
  committed to `schemas/openapi/`. Hand-written OpenAPI is forbidden.
- **Python DB driver:** PyMySQL only, with the **synchronous** SQLAlchemy
  2.0 engine. No async driver mixed in.
- **PDF:** WeasyPrint for report rendering.
- **Email:** Brevo transactional API, called only from `somnus-worker`.
  Templates are versioned and localized.
- **LLM:** GPT-5.6 via the OpenAI API, behind the
  `infrastructure/llm/` provider-abstraction module. Vertex/Gemini
  adapter is the documented EU fallback (§3.6).
- **Cold starts:** `min-instances = 0` everywhere. The only approved
  warm-up is a Cloud Scheduler ping to the edge API between 07:00 and
  24:00 Europe/Madrid, and only if login latency becomes a real
  complaint.
- **Stable releases only:** alpha / beta / rc / canary / nightly are
  rejected in CI.
- **Node.js 24 LTS, pnpm 10/11, NestJS 11, Fastify 5, TypeScript
  stable.**

## Consequences

- A new hire can read the build plan once and know the entire stack.
- Substituting a pinned library requires a new ADR superseding this
  one.
- Cold starts are the price of runway; this is a conscious trade.
