# ADR 0002 — Monorepo with independent deployments

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §2 (Repository decision), §6 (Repository structure)

## Context

Co-locating services in one repository is necessary for shared packages
(`api-contracts`, `errors`, `i18n`, etc.) and consistent quality gates,
but if the monorepo becomes a monolith, changes cascade and deploys
become coupled. The build plan demands both: shared code AND independent
deploys.

## Decision

Single pnpm-workspace monorepo (`pnpm-workspace.yaml` at the root,
workspace globs `apps/*`, `services/*`, `packages/*`). Each service
keeps its own `package.json` (or `pyproject.toml` for Python), its own
Dockerfile, its own CI build/deploy job. pnpm workspace is used for
code sharing, not for runtime coupling.

## Consequences

- Shared packages can be linked locally with `workspace:*` references.
- Each service is independently buildable, testable, deployable,
  scalable, and replaceable.
- A single `pnpm install` + `pnpm run ci` covers all of TypeScript.
- Python services stay outside the JS workspace but live in the same
  monorepo tree, sharing `docs/`, `schemas/`, and `infrastructure/`.
