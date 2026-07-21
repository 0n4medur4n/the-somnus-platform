# ADR 0010 — Five-service map with isolated modules, not more

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §2 (Deployable map), §5.4 (Consent isolated), §5.7 (Notification + Audit isolated)

## Context

Adding a service is operationally cheap in the cloud and organizationally
expensive. Some concerns — consent, notifications, audit — are often
proposed as their own services. The build plan instead asks for
**isolated modules** inside an existing service, with their own logical
database, migration history, and repositories, communicating only
through the module's public service interface.

## Decision

The deployable map is fixed: two static frontends + five Cloud Run
services (edge-api, identity, morpheo, report, worker). Three concerns
are isolated modules:
- **Consent** lives inside `somnus-identity-service` with its own
  database `somnus_consent`, its own migrations, its own repositories;
  identity code reaches consent only through the module's public
  service interface.
- **Notification** and **Audit** live inside `somnus-worker` with
  their own databases `somnus_notifications` and `somnus_audit`, their
  own migrations, and their own repositories.

Extracting an isolated module into a dedicated service is a
**deployment change**, not a rewrite.

## Consequences

- The number of deployables does not balloon with the number of
  concerns.
- Isolation is enforced at the data layer (own DB user, own schema,
  own migrations), not just at code boundaries.
- When load or security later justify extraction, the code is already
  shaped to be extracted.
