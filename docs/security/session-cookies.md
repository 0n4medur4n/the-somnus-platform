# Session cookie (somnus-edge-api)

## What is issued

`__session`, set by `POST /v1/sessions` (`sessions.controller.ts`), signed by `@fastify/cookie`:

| Attribute | Value | Why |
|---|---|---|
| HttpOnly | yes | Script never reads it. |
| Secure | yes (`COOKIE_SECURE=true`; deployed, `false` refuses startup) | Never sent over http. |
| SameSite | `Lax` (deployed `COOKIE_SAMESITE=lax`; `none` refuses startup deployed) | See below. |
| Path | `/` | One cookie for the whole API. |
| Domain | none (host-only; setting `COOKIE_DOMAIN` deployed refuses startup) | Only the host that set it receives it. |
| Max-Age | `SESSION_TTL_SECONDS` (default 7 days) | |

The CSRF token is not a cookie: it is an HMAC of the session id (`csrf-token.ts`) returned in the body.

### SameSite: Lax, and why

The SPAs reach the API on their own origin through the Hosting `/v1/**` rewrite, so the cookie is
first-party and never needs `None`. `Lax` is also what the deployed service already runs, so keeping it
changes nothing for anyone. `Strict` would probably also work for the SPA's own requests and
is a candidate, but it changes what a cross-site top-level navigation carries and was not exercised in
real browsers (Safari, iOS in-app browsers). CSRF is covered independently by the session-bound token
on every state-changing route. Recommendation: stay on `Lax`; try `Strict` on a preview channel first.

### `__Host-` prefix: no

`__Host-` would enforce Secure, `Path=/` and no Domain at the browser, which this cookie already has.
But Firebase Hosting forwards **only** a cookie named `__session` to Cloud Run (documented Firebase
behaviour, see `csrf-token.ts` and `edge-config.ts`); a `__Host-session` cookie would be stripped and
every request would arrive signed out. The same guarantees are enforced in code instead: startup
refuses `COOKIE_DOMAIN`, a non-Secure cookie and `SameSite=None`, and tests assert the attributes.
(Not tested live: that would need a deploy.)

## Secret: fails closed

Outside `NODE_ENV=development|test` (a missing `NODE_ENV` counts as deployed; the image sets
`production`) the service **refuses to start** if `COOKIE_SECRET` is missing, shorter than 32 bytes, a
development default or a placeholder (`dev-only`, `test-only`, `insecure`, `change-me`). The log names
the setting, never the value. Locally the old fallback still works.

Before deploying this version, check that the live secret passes (this prints only a number):

```
gcloud secrets versions access latest --secret=edge-cookie-secret --project=the-somnus | wc -c
```

It must print 32 or more. If it prints less, create a new version first (below), or the new revision
will not start.

## How the live service gets the secret

Terraform maps it as a Secret Manager reference, not a plain variable:
`environments/dev/main.tf`, `run_edge_api.secret_env_vars.COOKIE_SECRET = edge-cookie-secret, latest`.
The secret is created by hand (AUTOMATIC replication) and the `secretAccessor` binding for the edge
service account was also granted by hand (it is not in Terraform). Read-only check on 2026-11-10:
one version (created 2026-08-24, enabled), bound to `somnus-edge-api@the-somnus`, and the running
revision references `edge-cookie-secret@latest` for its only secret variable. Cloud Run resolves
`latest` when a revision starts.

## Rotation

Current plus previous: the current secret signs; either verifies. A person signed in with the old
secret stays signed in during the overlap; a new sign-in gets a cookie of the new one.

1. Create `edge-cookie-secret-previous` by hand (AUTOMATIC replication) holding the **old** value, and
   grant `roles/secretmanager.secretAccessor` on it to `somnus-edge-api@the-somnus`.
2. Add a new version to `edge-cookie-secret` (the new secret, at least 32 random bytes:
   `openssl rand -base64 48`).
3. In Terraform add to `run_edge_api.secret_env_vars`:
   `COOKIE_SECRET_PREVIOUS = { secret_id = "edge-cookie-secret-previous", version = "latest" }`
   and show the plan; the owner applies. Then deploy a new revision (so `latest` is re-read).
4. Wait at least `SESSION_TTL_SECONDS` (7 days; never more than 14).
5. Remove `COOKIE_SECRET_PREVIOUS` from Terraform, apply, deploy, and delete the `-previous` secret.

If the previous secret is removed too early, those people are signed out once (they sign in again).

Staging and production environments (`modules/environment`) do not set `COOKIE_SECRET` or
`COOKIE_SECURE` at all; with this change an edge-api started there without them refuses to start.
