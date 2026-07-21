# ADR 0003 — Each service and isolated module owns its data

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §7 (Service and module ownership), §8 (Data architecture), §9 (Temporary state)

## Context

A single shared database creates tight coupling between services and
makes retention, IAM, and schema evolution nearly impossible to govern
per context. The build plan requires independent, auditable retention
per logical database.

## Decision

Each Cloud Run service (and each isolated module within a service) owns
its own logical database on TiDB Cloud: `somnus_identity`,
`somnus_consent`, `somnus_morpheo`, `somnus_reporting`,
`somnus_notifications`, `somnus_audit`. Each has a dedicated user,
schema-scoped access, independent migration history, separate backup
validation, and service-specific pool configuration. No service or
module may read or write another service's tables. Communication is
only through authenticated HTTP APIs, versioned events, or — between
isolated modules inside one service — the module's public service
interface.

## Consequences

- A bug or migration in one service cannot corrupt another's data.
- Retention is enforceable per database.
- Cross-service queries (and the temptation to add them) are
  structurally prevented.
- Shared data is duplicated by event; eventual consistency is the
  norm and must be designed for.
