# somnus-edge-api

The Somnus platform's public **BFF** (backend-for-frontend), the only
service reachable from the internet (build plan §5.3 / ADR 0008). It
verifies Firebase ID tokens, issues and revokes server-side session
cookies, and applies the §21 security baseline (CSRF, strict CORS, rate
limiting, request-size limits, secure cookies). It is **not** a
business-domain service: it holds no domain logic, **never connects to
TiDB** (enforced by an architectural test), and reaches the private
services only over authenticated internal calls via
`@somnus/cloud-run-client` (OIDC identity tokens).

Cloned from the `somnus-identity-service` NestJS template (Fastify +
helmet, structured JSON logging, correlation IDs, the §16 error shape,
the `SomnusExceptionFilter`, the OpenAPI generator, a multi-stage
non-root Dockerfile).

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health/live` | Liveness probe. |
| GET | `/health/ready` | Readiness probe. |
| GET | `/version` | Service build info. |
| GET | `/docs` | Swagger UI for the generated OpenAPI doc. |
| POST | `/v1/sessions` | Exchange a Firebase ID token for a session cookie (login). |
| DELETE | `/v1/sessions/current` | Revoke the current session and clear its cookies (logout). |
| GET | `/v1/me` | Current actor's user + profiles, composed from identity (8.2). |
| PATCH | `/v1/me/profile` | Patch the individual profile via identity (8.2). |
| GET | `/v1/legal-documents/current` | Public: current legal documents, proxied from consent (8.2). |
| GET | `/v1/consents/current` | Actor's consent standing, proxied from consent (8.2). |
| POST | `/v1/consents` | Record consent, proxied from consent (8.2). |
| POST | `/v1/consents/:id/withdraw` | Withdraw consent, proxied from consent (8.2). |

## Composition (build plan §20 Checkpoint 8.2)

edge-api is a BFF: `/v1/me` and the consent routes are **proxied** to
the private `somnus-identity-service` (which hosts the consent module);
edge-api re-implements none of that logic. Internal calls go through
`@somnus/cloud-run-client`, which attaches a Google OIDC identity token
scoped to the downstream service's audience (Cloud Run IAM verifies
it), forwards the correlation id, and retries idempotent failures.

**Actor resolution.** The session (§10) carries only the Firebase uid.
Private services expect the internal Somnus user id in the
`x-somnus-actor-id` header, so on the first composed request edge-api
calls identity's internal `POST /internal/v1/users/resolve`
(Firebase-uid → Somnus user id) and **memoizes** the result on the
session document — every session pays that lookup at most once. A
Firebase user with no linked Somnus account surfaces as a clean `404`
(registration/provisioning is a separate flow, not this read path).

**Error normalization.** Downstream error bodies are mapped back to
`SomnusError` (`@somnus/cloud-run-client`) and rendered in the §16
error shape by the shared exception filter; a downstream timeout
becomes `UPSTREAM_UNAVAILABLE`.

Internal-call config: `IDENTITY_BASE_URL`, `IDENTITY_AUDIENCE` (OIDC
audience; defaults to the base URL), `INTERNAL_AUTH_MODE`
(`gcp` in production / `insecure-dev` for local/docker/tests, where
there is no metadata server), and `INTERNAL_TIMEOUT_MS`.

## Session flow (build plan §10)

1. The SPA authenticates with Firebase (Auth emulator locally) and gets an ID token.
2. `POST /v1/sessions` with `{ idToken }`. The edge API **verifies** the
   token (`firebase-admin`), then creates a server-side session.
3. The response sets an **HttpOnly, Secure, SameSite** cookie carrying
   only an opaque, signed session id — never the token, never any
   identity data. The ID token is discarded after verification.
4. Every later request rides that cookie; `SessionGuard` validates it
   against the store on each request.
5. `DELETE /v1/sessions/current` revokes the session server-side and
   clears the cookies.

The session identifies the user by their **Firebase uid**; the mapping
to an internal Somnus user id is resolved lazily and memoized on the
session (see **Composition** above).

## Why a server-side (Firestore) session store

The obvious choice would be Firebase's own session cookies
(`createSessionCookie` / `verifySessionCookie`). We verified
empirically that they **work** against the Auth emulator — except
revocation: the emulator does not enforce `revokeRefreshTokens` (it
doesn't even advance `tokensValidAfterTime`), so
`verifySessionCookie(cookie, checkRevoked=true)` can never reject a
revoked session there. Since Checkpoint 8.1 requires the "revoked
session rejected" test to pass **against the docker-compose/emulator
stack**, Firebase-native revocation is unusable.

So sessions live in a **server-side store**: the cookie carries an
opaque session id; a Firestore document (`sessions/<id>`) holds
`{ firebaseUid, email, createdAt, expiresAt, revokedAt }`. `revoke()`
writes `revokedAt` and the very next `validate()` fails — revocation is
immediate and absolute, with no dependency on Firebase (exactly ADR
0006's "revoking a user means revoking the session"). Edge-api has no
TiDB connection (§5.3), and build plan §9 sanctions Firestore for
exactly this "short-lived session lookup".

`SessionService` never caches: each `validate()` is a fresh Firestore
read, which is the per-request revocation + expiry check.

## Hardening (build plan §21)

Applied once in `src/bootstrap/harden.ts`, shared verbatim by
production (`main.ts`) and the tests — a CSRF/rate-limit/cookie
negative test is only meaningful if the app under test is hardened
identically to production.

- **helmet** — security headers.
- **CORS** — strict, restricted to the two Firebase Hosting origins
  (`CORS_ORIGINS`), `credentials: true` for the cookie.
- **cookies** — `@fastify/cookie` with a signing secret; the session
  cookie is signed + HttpOnly.
- **rate limiting** — `@fastify/rate-limit`; over-limit 429s are mapped
  to the §16 `RATE_LIMITED` shape by the exception filter.
- **request-size limit** — Fastify `bodyLimit` (session bodies are tiny).
- **CSRF** — `@fastify/csrf-protection`, double-submit: login issues a
  token via the readable `somnus_csrf` cookie; state-changing routes
  require it echoed in the `x-csrf-token` header, validated against the
  HttpOnly `_csrf` secret cookie. A global preHandler applies it to
  every POST/PUT/PATCH/DELETE **except** `POST /v1/sessions` (the login
  bootstrap, protected instead by requiring a valid ID token).

Cookie `Secure` is config-driven (`COOKIE_SECURE`): on in every
deployed environment, off for local plain-HTTP dev where a Secure
cookie would never be sent back.

## Configuration

Edge-specific config (`src/config/edge-config.ts`), validated at
startup:

| Env var | Default (local dev) | Notes |
|---|---|---|
| `FIREBASE_PROJECT_ID` | `somnus-dev` | Firebase project. |
| `FIREBASE_AUTH_EMULATOR_HOST` | (unset) | Set → firebase-admin uses the Auth emulator. |
| `FIRESTORE_EMULATOR_HOST` | (unset) | Set → Firestore client uses the emulator. |
| `SESSION_COOKIE_NAME` | `somnus_session` | |
| `COOKIE_SECRET` | dev fallback | Signs session + CSRF cookies; **required in prod**. |
| `SESSION_TTL_SECONDS` | `604800` (7d) | |
| `COOKIE_SECURE` | `false` | `true` in every deployed env. |
| `COOKIE_SAMESITE` | `lax` | |
| `CORS_ORIGINS` | localhost dev origins | Comma-separated Hosting origins. |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `100` / `60000` | |
| `BODY_LIMIT_BYTES` | `65536` | |

## Tests

The integration tests run against the Firebase **Auth + Firestore
emulators**. They cover build plan §20 Checkpoint 8.1's required
cases: token-exchange happy path, forged token, expired token, cookie
attribute assertions, CSRF rejection, rate-limit 429, and revoked
session — plus a direct `SessionService` test (expiry, idempotent
revoke) and a `SessionGuard` unit test.

Run them with the emulators wrapped by `firebase emulators:exec`
(no Docker required — needs Java for the Firestore emulator):

```bash
cd services/somnus-edge-api
firebase emulators:exec --only auth,firestore \
  --project somnus-dev-test \
  --config test/firebase.emulators.json \
  "pnpm test"
```

`pnpm --filter @somnus/edge-api test` on its own expects the emulators
to already be running with `FIREBASE_AUTH_EMULATOR_HOST` /
`FIRESTORE_EMULATOR_HOST` set (the wrapper above sets them). CI runs
the same `emulators:exec` wrapper (see `.github/workflows/ci.yml`, the
`edge-api` job).

### The one non-obvious emulator gotcha

The "expired token" negative test can't wait for a real token to
expire. Instead it crafts a structurally valid `alg:none` JWT with a
past `exp`: in emulator mode `verifyIdToken` skips signature
verification but still enforces `exp`, so it rejects the token with
`auth/id-token-expired` (verified empirically before relying on it).

## OpenAPI

```bash
pnpm --filter @somnus/edge-api generate:openapi   # writes schemas/openapi/edge-api.json
```

## Docker

```bash
docker build -t somnus-edge-api:dev -f services/somnus-edge-api/Dockerfile .
```

Multi-stage, non-root `somnus` user, `node:24-alpine`.

## Build plan

Implements build plan §20 Phase 8 — Checkpoint 8.1 (sessions and
hardening) and Checkpoint 8.2 (composition: internal OIDC clients via
`@somnus/cloud-run-client`, `/v1/me`, consent proxying, downstream
error normalization, and the `no-tidb.arch` test proving this service
holds no database connection).
