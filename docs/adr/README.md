# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for
The Somnus platform. Each ADR captures one significant decision in one
page, with a status, a date, the build-plan section it implements, and
the consequences.

## Index

| # | Title | Status | Build-plan section |
|---|-------|--------|--------------------|
| 0001 | One Cloud Run service per bounded context | Accepted | §2, §5 |
| 0002 | Monorepo with independent deployments | Accepted | §2, §6 |
| 0003 | Each service and isolated module owns its data | Accepted | §7, §8, §9 |
| 0004 | NestJS 11 + Fastify 5 for transactional services | Accepted | §3.4 |
| 0005 | Python 3.x + FastAPI for Morpheo, data, and controlled AI | Accepted | §3.5, §3.6 |
| 0006 | Firebase authenticates, The Somnus authorizes | Accepted | §10, §11 |
| 0007 | Morpheo is independent from identity and the worker | Accepted | §5.5, §14, §15 |
| 0008 | Internal services are private, edge API is the only public surface | Accepted | §2, §5.3, §21 |
| 0009 | Static frontends on Firebase Hosting (Astro marketing, Vite+React SPA) | Accepted | §3.1, §3.2, §5.1, §5.2 |
| 0010 | Five-service map with isolated modules, not more | Accepted | §2, §5.4, §5.7 |
| 0011 | Pinned technical decisions | Accepted | §3, §18, §2 |
| 0012 | Four-locale i18n from day one (es, en, ca, fr) | Accepted | §3.3, §22 |

## Convention

- File name: `NNNN-kebab-case-title.md`.
- One page maximum.
- Status values: `Proposed`, `Accepted`, `Superseded by ADR NNNN`.
- A new decision that contradicts an Accepted ADR must either
  supersede it (preserve history) or live alongside it as a
  `Proposed` ADR with rationale.

## Cross-references

- Build plan: [`../../THE_SOMNUS_PLATFORM_BUILD_PLAN.md`](../../THE_SOMNUS_PLATFORM_BUILD_PLAN.md)
- Prompt sequence: [`../../THE_SOMNUS_PROMPT_PLAYBOOK.md`](../../THE_SOMNUS_PROMPT_PLAYBOOK.md)
- Environment deviations: [`../environment-baseline.md`](../environment-baseline.md)
