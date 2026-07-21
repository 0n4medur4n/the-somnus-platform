# ADR 0004 — NestJS 11 + Fastify 5 for transactional services

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §3.4 (Transactional backend services)

## Context

Identity, edge API, and the worker are I/O-heavy, framework-bound,
transactional services. They need a strict, batteries-included
TypeScript framework with first-class schema validation and a fast HTTP
server suitable for Cloud Run cold starts.

## Decision

Use **NestJS 11** on top of **Fastify 5** (`@nestjs/platform-fastify`)
for every TypeScript service. Validation: **Zod 4** with **nestjs-zod**.
ORM: **Drizzle** over **mysql2**. Test: **Vitest**. Lint/format:
**Biome**. Package manager: **pnpm 10/11** (user-approved deviation to
11.5.0 recorded in `docs/environment-baseline.md`).

## Consequences

- Strict typing and DI without hand-rolled wiring.
- Fastify keeps cold-start latency acceptable on Cloud Run.
- Zod schemas double as OpenAPI source — one source of truth (§16).
- Drizzle migrations are reversible; Drizzle is a thin layer, not an
  opinionated ORM that could fight isolation rules.
- Pin all major versions; reject alpha/beta/rc/canary/nightly (§18).
