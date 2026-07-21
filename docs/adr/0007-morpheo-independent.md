# ADR 0007 — Morpheo is independent from identity and the worker

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §5.5 (Morpheo service), §14 (Morpheo data model), §15 (AI restrictions)

## Context

Morpheo is an assessment and orientation service, not an automated
medical-diagnosis engine. Its rule engine, scoring, safety flags and
orientation rules are pure deterministic code. Importing identity
tables, Firebase adapters, or email-sending code would couple the
safety-critical engine to unrelated concerns.

## Decision

`morpheo-service` is a standalone Cloud Run service with its own
database, migrations, and dependencies. It receives validated identity
and authorization context from the platform over authenticated HTTP.
It never manages passwords, organizations, identity records, or email
delivery. It never makes the final authorization decision. It never
invokes an LLM to score, flag, diagnose, or decide urgency; an LLM may
only rephrase approved structured results (§15). Every output records
the five rule versions + completion timestamp.

## Consequences

- The most-tested code in the platform can stay surgical and stable.
- Identity and consent changes cannot accidentally change a scoring
  rule.
- Anonymous-assessment flow is possible because Morpheo does not
  require a pre-existing user record.
- The eventual AI-rewording of reports happens in the report service,
  not in Morpheo.
