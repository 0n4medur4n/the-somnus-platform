# ADR 0006 — Firebase authenticates, The Somnus authorizes

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §10 (Authentication), §11 (Authorization)

## Context

Authentication and authorization are different responsibilities.
Firebase Authentication is excellent at the first; it must not be
trusted to make authorization decisions for a clinical product. A
leaked or stale Firebase custom claim must never be sufficient to
expose health data.

## Decision

**Firebase Authentication** owns identity proof (initial scope:
passwordless email link; Google sign-in where appropriate). Every
authenticated request then goes to the Somnus edge API, which verifies
the Firebase ID token, mints an HttpOnly / Secure / SameSite session
cookie, and forwards the validated identity + authorization context to
`somnus-identity-service`. All authorization decisions live in the
identity service: RBAC, organization-membership checks, professional-
verification checks, access grants, status, expiration. Firebase
custom claims are never the primary authorization system.

## Consequences

- The platform is the source of truth for "who can do what".
- Revoking a user means revoking the session, not waiting for an
  out-of-sync Firebase claim to refresh.
- Edge API composition can rely on a stable, audited authorization
  context — not on a token.
- The edge API cannot become a second source of authorization truth
  (it does not run business rules; identity does).
