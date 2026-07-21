# ADR 0008 — Internal services are private, edge API is the only public surface

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §2 (Deployable map), §5.3 (somnus-edge-api), §21 (Security baseline)

## Context

Five services exist. The edge API is a BFF, not a business-domain
service. Exposing identity, morpheo, report or worker directly to the
internet would multiply the attack surface and force each of them to
re-implement authentication, rate limiting, and CORS.

## Decision

Only `somnus-edge-api` is `ingress-allow-all` and reachable from the
public internet. The other four Cloud Run services are deployed with
`ingress = internal` (or restricted IAM) and accept only authenticated
calls from the edge API's service account via
`packages/cloud-run-client` (OIDC, explicit audience, timeouts, retry,
correlation propagation). The edge API does not connect to TiDB; it
composes, normalizes errors, applies rate limits and CORS, and
maintains correlation IDs. No service duplicates another service's
authorization or consent logic.

## Consequences

- A single hardened entry point.
- A leaked internal-only endpoint cannot be reached without a valid
  OIDC token from the edge.
- The BFF is bounded and replaceable; if it grows beyond composition,
  the team must extract a new service rather than letting it bloat.
- IAM blast radius is small; every internal call is auditable.
