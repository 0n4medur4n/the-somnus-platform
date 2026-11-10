# ADR 0027 — notes: rationale and sources

Companion to [ADR 0027](0027-passkeys-for-the-admin-console.md). The ADR holds the
decision; this file holds why. Where the two differ, the ADR wins.

Repository citations are to `origin/main` `5858fda` unless a line says otherwise.
Official pages were read on 2026-11-05.

## 1. Session profile

The cookie limits follow the product. Edge-api decides that from the verified
request origin (notes 16), not from a value the browser chooses. A console
session, started with the email link or with a passkey, sets `__session` with
`Secure`, `HttpOnly`, `SameSite=Strict` and no `Domain`. Idle 30 minutes,
absolute 10 hours. That is the only visible change for someone who signs in
to the console with the link, and it never lengthens a session. `/admin/v1/*`
answers only sessions classified as console, whatever the value of the switch.
A link session started from the app origin is refused there. For a person who
signs in from the console origin, nothing changes. `lastSeenAt`
moves the idle window and is written at most once a minute. A write less than
a minute newer than the stored value is skipped. The absolute end is
`authTime` plus 10 hours and does not move.

An app session keeps `SameSite=Lax` and 7 days. That is today's behaviour for
the app (`sessions.controller.ts`, `edge-config.ts`). While
`CONSOLE_REQUIRE_PASSKEY` is false, the default and this rollout, an email
link opens the console exactly as today for everyone. Having a passkey
changes nothing about that link.

Sessions already stored have no `client`, `amr`, `authTime`, `lastSeenAt`,
`stepUpAt` or credential id. They keep working for the app. When the switch
is true, `/admin/v1/*` requires `amr` = `passkey`, and a missing `amr` does
not match. While the switch is false, an email-link session still opens the
console. No sentence in this ADR requires `amr` = passkey except under that
switch.

`client` is `app` or `console`. `amr` is `passkey` or `email_link`. `authTime`
is when that ceremony succeeded. `stepUpAt` is written only after a fresh
user-verified assertion, on a fresh challenge, by an active credential of the
same user. Once the person has an active passkey, decision 11 checks that now
minus `stepUpAt` is under 5 minutes, in a link session or a passkey session,
and the action stays CSRF-protected. With no active passkey, those actions
work as today. A link session needs no passkey to read or to do non-critical
work. `stepUpAt` does not move `authTime`. `lastSeenAt` never sets it.

Only a passkey session stores the credential id that created it. Names of new
fields are chosen at implementation. Sessions live in edge-api's Firestore,
and identity cannot write that database. On every admin request
`AdminCapabilityGuard` resolves the actor and then either calls
`hasAnyInternalRole` or `checkCapability` (`admin-capability.guard.ts` lines
48–54). Those call identity's `POST /internal/v1/authorization/admin-context`
or `admin-check` with `actorUserId`, and for a capability also the capability
name (`admin.service.ts` lines 33–43). For a passkey session that existing
call also carries the credential id. Identity denies the request when that
credential is not active or does not belong to the actor. A link session
carries none. While the switch is false, that absence does not deny the
request, and a passkey does not end or block the link. With the switch true,
an admin request with no credential id is denied, because the console is then
passkey only. A reopen or the recovery script only changes identity's data.
"Sign out of all my console sessions" stays an edge-api action. `/admin/v1/me`
uses the same guard but only the role-list branch. `GET` and
`POST /v1/staff-invitation` are outside it
(`staff-invitation.controller.ts` lines 18–19 and 22–23). The credential
check covers those too, for passkey sessions. Phase 2's negative tests include
a revoked-credential session, a locked-credential session, and a suspended
account. A passkey session still inside its 10 hours must not keep working
after that credential is dead.

NIST SP 800-63B-4, AAL2 reauthentication, read on 2026-11-05 at
<https://pages.nist.gov/800-63-4/sp800-63b/aal/>: the overall timeout SHOULD be
no more than 24 hours, and the inactivity timeout SHOULD be no more than 1
hour. This policy is stricter (10 hours, 30 minutes). That same paragraph
allows, after inactivity but before the overall timeout, a reauthentication
with only a password or a biometric plus the session secret. This ADR does not
use that fallback: idle ends the session.

## 2. Minting without a Firebase ID token

`POST /v1/sessions` accepts only a Firebase ID token
(`sessions.controller.ts`). A passkey that Firebase did not check cannot use
that route unless someone mints a custom token, which needs
`iam.serviceAccounts.signBlob`
(<https://docs.cloud.google.com/identity-platform/docs/admin/create-custom-tokens>).
The ADR forbids both.

The new method is internal to edge-api. The browser never calls it with a bare
user id. The public routes are proxied to identity. Identity confirms the
assertion and returns the Somnus user id and the Firebase uid already linked
on `user_identities`. Edge-api does not produce those ids. It writes the same
session shape it writes today, plus the fields in decision 8, and sets the
cookie. If the account status is not `active`, identity refuses the assertion
and no session is created. That is in addition to the per-request check in
notes 1. An active account with no role may still receive a passkey session,
because the invitation is accepted from that session. Composition still
forwards the Somnus user id. Identity still does not set cookies, and edge-api
still does not decide roles.

## 3. Challenges live in the identity database

Firestore was the first proposal because build plan §9 allows short-lived
tokens there. The only Firestore database in dev Terraform is edge-api's
session database, and it has no TTL policy. A second Firestore database would
have been new Terraform, and identity writing edge-api's database would break
ADR 0003.

The challenge is five minutes of identity state. It belongs in identity's
MySQL, next to the credential, in a Drizzle migration. Identity generates the
options and verifies the response. edge-api proxies the public routes and does
not store the challenge.

Consumption is one conditional `DELETE`: the id matches, `expires_at` is still
in the future, and the statement reports one affected row. Zero rows is a
replay, an unknown challenge, or an expiry, and the assertion is rejected.
There is no separate "mark used" update to race with.

An expired row is never usable: the conditional `DELETE` requires `expires_at`
still in the future. Rows that nobody consumes are deleted by identity itself,
when it creates a new challenge: one bounded `DELETE` of rows already expired.
There is no Cloud Scheduler job and no worker endpoint. In
`infrastructure/terraform/environments/dev/main.tf` every scheduled job is its
own `cloud-scheduler-job` module plus a route under `/internal/v1/jobs`. A
cleanup of that shape would be Terraform. This one is not.

Terraform review for challenges: none. No Firestore database, no Firestore TTL,
no scheduler, no worker route, no new secret. Identity tests keep using the
per-run local MySQL, never the TiDB dev cluster. That constraint is already how
the identity CI job is wired, and this work does not loosen it.

## 4. Enrollment

While the switch is false, the email link opens the console exactly as today
for everyone. Having a passkey changes nothing about that link. The person
enrolls alone, with no code and no helper.

1. They sign in with the email link as today, from the console origin.
2. Before any credential is accepted, the server checks, all automatically:
   the email-link sign-in happened within the last 10 minutes (if it is older,
   the screen asks for a new link in one tap); the account status is active;
   the email in the sign-in is verified and equals the Somnus user's email;
   the user holds at least one internal role or, for a new invitee under the
   2026-11-07 rules, a matching pending invitation; the session is a
   console-origin email-link session. A user with no internal role and no
   matching invitation, for example an app user, can never register a console
   passkey.
3. The user has zero active passkeys. Adding another needs a fresh passkey
   assertion of an existing one (step-up).
4. The credential is pending until its first successful passkey sign-in, the
   immediate sign-in after registration. A pending credential cannot be used
   for step-up and does not count as active. If that sign-in fails, it stays
   pending. The person signs in with it later. It becomes active only once
   that sign-in has worked.
5. Every registration and every removal emails the account owner, in plain
   words, telling them to contact a super admin if it was not them. No link
   in that email grants access. edge-api enqueues it (notes 12).
6. A super admin never registers or adds a passkey for another person and
   never sees credential material. A super admin can only revoke a person's
   passkeys, after step-up, when they lose every device. With the switch
   false, the person can then enroll again as anyone with none.
7. During this rollout the mailbox is the only proof for people who have not
   enrolled yet, exactly as today, so enrollment adds no exposure. Each person
   closes that residual risk by enrolling. With the switch false, whoever
   controls the mailbox can still open the console for non-critical work, as
   today. They cannot perform that person's critical actions, and they cannot
   add a passkey once the person has an active one.

Two alternatives were considered and not chosen: a verification code handed
over by a super admin, and live approval by a super admin. The owner wants
people to enroll alone and easily.

Every new staff invitation lasts 72 hours, with the switch true or false. That
changes `STAFF_INVITATION_TTL_DAYS`
(`packages/api-contracts/src/identity/staff-invitation.ts` line 33), which is
7 today. Invitations already pending keep the `expiresAt` stored with them. An
invitation not accepted within 72 hours must be sent again.

The following applies only with the switch true, which is not this rollout.
The email link can only enroll inside an open window. A 15-minute
registration-only session (never `/admin/v1/*`) is issued only when active
passkeys are zero and a window is open. An invitation opens a window only
then; otherwise the role is granted at accept and no window opens. A window
is open only while active passkeys are zero. A reopen is a super admin who
has just done step-up. It is single use, it expires after 24 hours, and the
user is emailed when it opens. The invitation enrollment window lasts as
long as the invitation, 72 hours (notes 16). A reopen window stays 24 hours.
The window is consumed by one conditional update, and only when the first
passkey is registered successfully. A failed or abandoned ceremony does not
consume it, and it cannot be consumed twice. Opening a reopen revokes that
user's passkeys first, which ends the console sessions created with them
(notes 1). If any passkey is active, the email link yields no session. The
response is generic. The audit event is `auth.passkey.enrollment_refused`,
with no free text. Those windows and that event do not apply while the switch
is false.

If every super admin loses every device, the owner script revokes the passkeys.
With the switch false the person then enrolls again from the link, because
they have none. The switch is not flipped.

The recovery is an owner-run, audited one-off script. A normal reopen is an
HTTP route: it requires step-up and the super-admin capability. A script cannot
do a step-up. The domain operation is separate. It revokes that user's
passkeys, which ends the console sessions created with them (notes 1), and
writes the audit events. With the switch true it also opens the enrollment
window. The script calls the domain operation, not the route, and not
hand-written SQL. It does not write Firestore. The owner runs it with Google
Cloud IAM, for a named super admin, and only when no other super admin can.
The other super admin can revoke instead. Neither depends on who owns the
accounts. The script must not call the platform bootstrap and must not weaken
it.

Identity running with its own least-privilege database user, instead of the
shared cluster user, and rotating that credential, is a prerequisite before
real patients and before this script is used. Agents and scripts never print,
log, store or paste the connection URL. The owner reviews who can read the
secret that holds it. From the owner's check of 2026-11-10: the secret's own
access policy lists only identity's runtime service account with the
secret-accessor role. At project level, one personal Google account holds the
Owner role and the default Compute service account holds the Editor role.
Those broad roles can normally read secrets, so reviewing them is a separate
owner task: a strong second factor on the Owner account, and removing Editor
from the Compute service account through Terraform if nothing needs it,
checked first. No account name or secret value is written here.

The script's actor is not `assignedBy` = null. That null is reserved for the
platform bootstrap: `roles.schema.ts` lines 68–77, and
`role-assignments.repository.ts` lines 10–16. `InternalRolesService` writes
null only when the source is `bootstrap` (`internal-roles.service.ts` line
134). The script's audit events use their own explicit system-actor marker.
The name is chosen at implementation. No existing user id is impersonated.

How the script reaches the database is listed here, none chosen. The bootstrap
(`services/somnus-identity-service/scripts/bootstrap-super-admin.ts`) opens the
pool from `DATABASE_URL` and `DB_SSL` in the environment (lines 31–33 and 89;
`db.config.ts` lines 9–16). Its Google Application Default Credentials are used
only to read the bootstrap email secret from Secret Manager (lines 59–66), not
to open the database. Deployed identity receives `DATABASE_URL` from the secret
`identity-db-url` (`infrastructure/terraform/environments/dev/main.tf` line
248). A recovery script that connects the same way as the bootstrap therefore
needs that database URL in its environment. Options present in the repository,
none chosen: the operator supplies `DATABASE_URL`, as the bootstrap does; the
script reads Secret Manager with ADC, the pattern the bootstrap uses for the
email secret; or the work runs where Cloud Run has already injected the
variable. In dev and in this repo's CI, consent and identity share one TiDB
cluster user (`services/somnus-identity-service/README.md` lines 234–239). The
README states that a real environment gives `somnus_consent` its own database
user. A per-database user, instead of that shared cluster user, is a
prerequisite before real patients, and this script is one more reason: it
would otherwise hold the same credential as the running service.

A super admin who reopens a window for someone else must first verify that
person through another channel, for example a call. That check belongs in the
recovery runbook of phase 6.

## 5. CSRF

`isCsrfExempt` in `services/somnus-edge-api/src/bootstrap/harden.ts` is an
explicit list. `POST /v1/sessions` and `POST /v1/auth/email-link` are on it
because no session cookie exists yet. The pre-session passkey login routes
join that list for the same reason. Register, rename, remove and step-up ride
the session and require the CSRF header.

`test/unit/csrf-exempt-routes.test.ts` asserts both sides: the exempt paths,
and that routes which ride a session are not exempt. A new login path that is
missing from the exempt list fails closed (the browser cannot send a token it
does not have yet). A new authenticated path that is added to the list by
mistake fails the negative case. The list stays explicit. A blanket "paths
starting with /v1/auth" exemption is not acceptable.

## 6. Preview channels

CI deploys the console, with the other Hosting sites, to a per-PR preview
channel (`.github/workflows/ci.yml`, `hosting:channel:deploy`). That origin is
not `https://console.thesomnus.com`, so WebAuthn rejects it. This is accepted.
Passkey tests run locally, against the localhost relying-party config, with a
Playwright/CDP virtual authenticator. A preview is still useful for visual
checks of layout and copy. It is not a sign-in test, not a passkey test, and
not a test of `/admin/v1/*`.

## 7. Why option B is rejected

Option B kept one `platform_super_admin` user id and several passkeys on it.
Audit, break-glass and the self-assignment rule all key off that user id, so
none of them can name which person acted. Option A gives each person their own
account. The actor id is the person, and the self-assignment rule still
applies. The owner chose that. The role is granted to an existing user id from
the role-holder check, never by typing an email into an invitation, because a
mistyped address would send a super-admin invitation to a stranger. The
bootstrap is not reopened or weakened.

## 8. Open item: who holds the roles

At step (d) of notes 17, the owner runs this read-only query and accounts for
every row. Unknown accounts are revoked, and so is any other holder of
`platform_super_admin` after the two chosen accounts have enrolled. This is an
open item for the owner, not a product decision. The two chosen accounts are
not named here.

```sql
SELECT r.`key` AS role_key,
       ra.user_id,
       u.email,
       u.status AS account_status,
       ra.assigned_at
FROM role_assignments AS ra
INNER JOIN roles AS r ON r.id = ra.role_id
INNER JOIN users AS u ON u.id = ra.user_id
WHERE ra.revoked_at IS NULL
  AND r.is_internal = 1
ORDER BY r.`key`, u.email;
```

Counts taken on 2026-11-05 from the dev database, to be re-checked by the
owner with the query above: `support_agent` 0, `professional_verifier` 0,
`clinical_governance_reviewer` 0, `platform_admin` 4, `platform_super_admin` 1.
Five distinct user ids, none holding two internal roles. The count is one
`platform_admin` more than the owner expected, so that holder is unaccounted
for.
`apps/somnus-admin/README.md` still says nobody holds `platform_super_admin`.
That sentence is wrong against this count and is a documentation fix listed
in the ADR, not edited here.

## 9. Credentials and authenticators

The credential row holds: credential id (unique), user id, public key, sign count,
transports, AAGUID, backup eligible, backup state, the name the person gave it,
`created_at`, `last_used_at`, `revoked_at`.

The console is the only relying party. The app's email link does not change.
Authenticators are synced platform passkeys plus hybrid QR, not a required
hardware key, because that set meets AAL2 and does not meet AAL3: AAL3 forbids
syncable authenticators. Attestation stays `none`. A zero sign count that stays
zero does not lock the credential; synced passkeys often report zero forever
(<https://www.w3.org/TR/webauthn-2/#sctn-sign-counter>). A non-zero count that
does not increase does lock it.

Usernameless registration and sign-in avoid asking for an email at the start of
the ceremony. Conditional UI and the Signal API are used only when
`getClientCapabilities` says the browser has them
(<https://www.w3.org/TR/webauthn-3/>).

## 10. Firebase and library sources

Firebase's own documentation, read 2026-11-05, does not offer passkey sign-in.
The product page lists email/password, federated providers, phone, custom auth
and anonymous (<https://firebase.google.com/docs/auth>, updated 2026-11-05 UTC).
The JS reference and the REST reference have no passkey or WebAuthn method
(<https://firebase.google.com/docs/reference/js/auth>,
<https://firebase.google.com/docs/reference/rest/auth>). Identity Platform's
documented extension is a custom token, which this ADR refuses
(<https://cloud.google.com/identity-platform/docs/web/custom>). Its documented
web MFA is SMS (<https://docs.cloud.google.com/identity-platform/docs/web/mfa>).
Hosting still forwards only the cookie named `__session`
(<https://firebase.google.com/docs/hosting/manage-cache#using_cookies>).

`@simplewebauthn/server`: <https://simplewebauthn.dev/docs/packages/server>.
The version is chosen at implementation, and it is a stable release.

## 11. Headers, CSP and the microphone

The console HTML headers in `firebase.json` have no `Content-Security-Policy`
and no `frame-ancestors`. They do have `X-Frame-Options: DENY` and
`Permissions-Policy: geolocation=(), microphone=(self), camera=()`. An enforced
CSP that is wrong would lock every operator out, including the email-link
callback, so decision 16 ships `Content-Security-Policy-Report-Only` first and
enforces it only after console sign-in and that callback have been checked
with no violations. The enforced policy must allow the Firebase endpoints the
callback uses. Violations are observed by the owner and each operator in the
browser console during that check. No report endpoint is built. An endpoint
would need its own CSRF exemption and its own rate limit, and is out of scope.
Dictation in the staff Drive stays, so `microphone=(self)` stays on the console.

The console does use a microphone today. Document dictation in the staff Drive
calls `getUserMedia` and `AudioContext` in
`apps/somnus-admin/src/drive/documents/dictation.ts` (the call is at line 218;
`AudioContext` is constructed at line 255). `VoiceTools.tsx` starts that
session at line 162. `voice.test.tsx` fakes both APIs. No `MediaRecorder`
appears in `apps/somnus-admin` or in `@somnus/api-contracts`, the only workspace
package the console imports. Copy for the microphone is in
`apps/somnus-admin/src/i18n/locales/en.json` (lines 796, 803 and 804). Because
dictation stays, the header keeps `microphone=(self)`.

Challenges, assertions, attestations and session cookies are never logged.

## 12. UX, errors, email and i18n

People manage their own passkeys: add a device, rename, remove (with step-up),
sign in, and sign out of all console sessions. One task per screen. Plain
language, without the words WebAuthn or FIDO. A short visible explanation of
what the device will ask for. Progress indication. The same flow on Mac,
iPhone, Windows and by QR. Every error has a clear next step, including a link
that is too old, a device without passkey support, a cancelled passkey, and no
console role. No timeout that loses progress. During the rollout the console
shows a gentle, dismissible prompt, "Activate your passkey", to people without
one. The button is "Sign in with passkey". "My passkeys" lists, renames and
removes. A second passkey, on another device or provider, is optional and needs
step-up. Every passkey added or removed emails the owner in plain words, with
no link that grants access (notes 4).
edge-api enqueues it, after identity confirms the change. edge-api already
holds `roles/cloudtasks.enqueuer` on the notifications queue
(`google_cloud_tasks_queue_iam_member.edge_enqueue_notifications` in dev
`main.tf`); that binding is the only `cloudtasks.enqueuer` in Terraform, and
it is edge-api's service account, not identity's. IAM and Terraform impact of
the email: none. The new notification type is a contract and template change.
All strings go through i18n, es, en, ca and fr. No hardcoded user-facing
string. A missing key fails CI.

## 13. Negative tests

Negative tests, in this order: an email-link sign-in for a user with an
active passkey yields no session once the switch is true; an expired window
yields none; an already used window yields none; opening a reopen window
revokes the existing credentials and their sessions; an enrollment-only
session cannot register a credential for a different user; then wrong origin,
wrong rpId, reused challenge,
expired challenge, user verification false, unknown credential, revoked
credential, sign count that does not increase, an email-link session refused
on `/admin/v1/*` once the switch is on, an enrollment-only session refused on
`/admin/v1/*`, step-up refused when the assertion is older than five minutes.
Also: a suspended account cannot create a passkey session; a deleted account
cannot create a passkey session; an unverified address does not match an
invitation and creates no user; an invitation past 72 hours yields no window
and no user; an address with no pending invitation creates no user; two
concurrent sign-ins provision one user; with the switch true, `GET` and
`POST /v1/staff-invitation` refuse a session whose `amr` is not passkey.
Also: an app-origin email-link session cannot register a passkey; an
app-origin email-link session cannot call `/admin/v1/*`; a request with a
forged client value and a non-console origin gets no console behaviour.
Also, origin tricks: `console.thesomnus.com.example`, a path or host that only
contains `console.thesomnus.com`, `http` instead of `https`, a port, a trailing
dot, and different case. A forged console Origin cannot register without the
checks in notes 4. A user with no internal role cannot register a console
passkey. An email-link sign-in older than 10 minutes cannot register. An
assertion for another origin or rpId is rejected. `crossOrigin` = true is
rejected. A link session of a person with an active passkey cannot perform a
critical action without a fresh assertion. A link session of a person with no
passkey still works as today. With the switch false, the email link still
opens the console for a person who has a passkey. An app-origin link session
is refused on `/admin/v1/*` with the switch false, and a console-origin link
session still works.
Then the positive cases. CI uses a Playwright/CDP virtual authenticator.
Manual checks cover Mac, iPhone, Windows and QR.

## 14. Routes outside `/admin/v1`

The console's API client is `apps/somnus-admin/src/lib/edge.ts`, plus
`apps/somnus-admin/src/lib/api.ts` for the CSRF fetch. `@somnus/api-contracts`
is types only and makes no request. Everything under `/admin/v1/` returns or
changes staff-only data and is already behind the admin gate.

Outside that prefix:

- `POST /v1/sessions` (`edge.ts` line 103) and `GET /v1/sessions/csrf`
  (`api.ts` lines 10 and 131) and `DELETE /v1/sessions/current` (`edge.ts`
  line 105) establish, refresh or end the caller's own session. They do not
  return staff records.
- `POST /v1/auth/email-link` (`edge.ts` line 108) sends a sign-in link and
  answers the same way whether or not an account exists. It does not return
  staff records.
- `GET /v1/staff-invitation` (`edge.ts` line 137) returns the caller's own
  pending staff invitation, including the role that invitation would grant.
- `POST /v1/staff-invitation/accept` (`edge.ts` line 139) grants that role to
  the caller. Both exist because the person may hold no internal role yet, so
  they cannot pass `/admin/v1/*`. With the switch true, both stay outside
  `/admin/v1/*` and require a session with `amr` = passkey. While the switch is
  false they work as today (decision 9).

## 15. Follow-up documentation fixes

Addendum A is not in this repository. The follow-up fix applies to the
workspace copy of `THE_SOMNUS_BUILD_PLAN_ADDENDUM_A.md`: §A1 says the magic
link is the single authentication mechanism, and Checkpoint 15.1 says the
console logs in with that link. ADR 0006 is already in `origin/main`. This ADR
amends it for the console only. The admin README still says nobody holds
`platform_super_admin`. None of those files are edited with this ADR.

## 16. New staff and the console origin

Origin is decided in this order.

(i) The strong check is cryptographic. Identity verifies the WebAuthn
assertion against `expectedOrigin` and `rpId` by exact string match. Production
has no wildcard and no list other than `https://console.thesomnus.com`. The
localhost configuration exists only in the development configuration and never
in a production environment. `crossOrigin` = true, or a different top origin,
is rejected. A passkey created for the console cannot be used from any other
site.

(ii) Registration and critical actions rest on server-side state, not on a
header: the account and email checks in notes 4, zero active passkeys for a
first passkey, and the step-up rule in decision 11.

(iii) Defense in depth. Edge-api gives console behaviour only when the Origin
header equals `https://console.thesomnus.com` by exact comparison, never
`startsWith` or a regular expression, and, when the browser sends it,
`Sec-Fetch-Site` is `same-origin`. If either check fails, the session is an
ordinary app session and cannot register a passkey. CORS stays an exact
allowlist (`harden.ts` lines 82–83, `CORS_ORIGINS` at `edge-config.ts` lines
59–69). A non-browser caller can forge these headers, so they are not the
barrier. Today `POST /v1/sessions` does not read Origin
(`sessions.controller.ts` lines 43–68; `session.ts` lines 9–13), and
`POST /v1/auth/email-link` lets the body choose `client` (`task.ts` line 49),
which only selects the callback (`auth-email-link.service.ts` lines 47–48).
The smallest change is the exact comparison above, ignoring `client` for the
session.

An app-origin session never registers a console passkey. `/admin/v1/*` answers
only a session classified as console, whatever the switch, so a link session
started from the app origin is refused there. For a person who signs in from
the console origin, nothing changes. With the switch true an app-origin
session also cannot accept a staff invitation, and a console-origin email link
yields at most an enrollment-only session. With the switch false, that link
opens the console as today.

Phase 2 first verifies, in the dev environment, that the console Origin header
reaches edge-api through the Hosting rewrite. If it does not, this ADR is
amended before building. Nothing here claims that the header arrives today.

A person who has no account yet:

1. A super admin creates the invitation, after step-up (decision 11). Creating
   it is `POST /admin/v1/staff-invitations`, capability `admin_roles_assign`
   (`admin-staff-invitations.controller.ts` line 76). Identity stores the row
   in `staff_invitations` (`roles.schema.ts` line 89) and sets `expiresAt` to
   now plus the invitation lifetime. Today `STAFF_INVITATION_TTL_DAYS` equals 7
   (`packages/api-contracts/src/identity/staff-invitation.ts` line 33), applied
   in `staff-invitations.service.ts` line 96. The decision changes that
   constant so a new invitation lasts 72 hours, with the switch true or false.
   A row already pending keeps the `expiresAt` it has stored. One not accepted
   within 72 hours must be sent again. No Somnus user exists at create time
   (`staff-invitations.service.ts` lines 60–63).
2. The invitation email carries a console sign-in link
   (`staff-invitation-email.service.ts`).
3. The person signs in to the console with that email link. Until a Somnus user
   exists, the enrollment window is keyed to the invitation id and the
   normalized verified address. When edge-api creates a console email-link
   session for a verified address that matches a pending, unexpired invitation,
   it calls an internal identity operation. That operation provisions the user
   with no role, links the Firebase uid, and returns the Somnus user id. It is
   idempotent and race-safe because `users.email` is unique (`users.schema.ts`
   line 17). Names of the operation and of any new field are chosen at
   implementation. An unverified address matches nothing. No matching
   invitation creates no user. With the switch false, that session is an
   ordinary console link session and the person enrolls as in notes 4. With
   the switch true, the window becomes that user's window. If they have zero
   active passkeys, the enrollment-only session is issued. A window is open
   only while active passkeys are zero, and only while the switch is true. If
   this address already belongs to a Somnus user, the operation
   keeps what accept does today (`staff-invitations.service.ts` lines 152–176),
   and decides nothing new. A Firebase uid already linked to a user with the
   same address reuses that user (lines 153–164). An address that already has
   an account under a different sign-in is a conflict: no second user is
   created and the new uid is not linked (lines 166–173). That is accept's
   current conflict and is not a new rule. The email-link session still opens.
   With the switch true, no enrollment window binds: a generic response and
   `auth.passkey.enrollment_refused`.
4. They register the first passkey on that user id. With the switch true, the
   window is consumed by one conditional update. The UI then signs in with that
   passkey. The credential stays pending until that sign-in succeeds, and only
   then is it active. If the sign-in fails, it stays pending.
5. With that passkey session they accept. `GET /v1/staff-invitation`
   (`staff-invitation.controller.ts` line 27) and
   `POST /v1/staff-invitation/accept` (line 36) are outside `/admin/v1`.
   Pending sends the session email (`staff-invitation.service.ts` lines 32–35). Accept sends the session email
   and Firebase uid (lines 51–53). Neither takes those from the request body.
   Identity matches the pending, unexpired invitation by that address
   (`staff-invitations.repository.ts` `findUsableByEmail`, line 66).
6. Accept grants the role and does not create the user again. Today, before
   this design, identity creates the user at accept
   (`staff-invitations.service.ts` lines 175–176) and then grants the role
   through `InternalRolesService` on behalf of the inviting admin (lines
   198–203). The grant stays here, and only a session with `amr` = passkey
   may accept while the switch is true.
7. `GET /admin/v1/me` then resolves that user.

What a user row requires today: `users` (`users.schema.ts` lines 15–21) needs
`id`, `email` (unique, not null), `locale` (not null, default `es`), `status`
(not null, default `active`; values `active`, `suspended`, `deleted`), and the
two timestamps. `UsersRepository.create` (lines 25–28) inserts only id, email
and locale. No profile row is required. `GET /v1/me` returns
`individualProfile: null` when none exists (`me.service.ts` lines 46–61) and
still returns the user. Patching a missing profile is 404 (lines 128–132). A
user with no role and no profile is a valid row. The admin gate denies
`/admin/v1/me` while `roleKeys` is empty (`admin.service.ts` lines 57–59).

(a) Until the user exists, the invitation window is keyed to the invitation
id and the normalized verified address. At the first matching sign-in it
becomes that user's window. Today no Somnus user exists until accept (the
comment at lines 60–63). (b) Today `somnus-identity-service` creates the user
at accept, not at invitation. The other place a user is created is ordinary
registration (`users-provision.service.ts` line 73). (c) Today the constant
`STAFF_INVITATION_TTL_DAYS` is 7
(`packages/api-contracts/src/identity/staff-invitation.ts` line 33). The
decision changes it so a new invitation lasts 72 hours, with the switch true
or false. A row already pending keeps its stored `expiresAt`. One not accepted
within 72 hours must be sent again. With the switch true, the invitation window
lives as long as the invitation, 72 hours, and a reopen window stays 24 hours.
In that future mode, possession of the mailbox can start enrollment for those
72 hours. While the switch is false, the link works as today and those windows
do not apply.

The rejected alternative was keeping the new credential tied to the invitation
and moving it onto the user at accept. The cost was two homes for one
credential, and a move that could fail after the person had already proved the
passkey.

## 17. Migration order

(a) Deploy with the switch false. Nothing changes for anyone except the
console session limits in decision 8. The email link keeps working. No one is
blocked. The console shows a gentle, dismissible "Activate your passkey"
prompt to people without one. (b) Each person activates their passkey alone
and signs in with it once. From then their critical actions are protected
(decision 11). A passkey counts as active only after that sign-in has worked.
(c) The two chosen accounts hold `platform_super_admin`, granted by user id if
they do not already, by an existing super admin in the console or by the
owner-run audited script. Each enrolls. The owner confirms they can use
super-admin functions. (d) The owner runs the role-holder check (notes 8),
revokes unknown accounts, and revokes any other holder of
`platform_super_admin`. (e) Later, and only if the owner decides, once every
console account has an active passkey, the owner may set the switch true in
Terraform. That is not part of this rollout. (f) People invited later enroll
as in notes 4 while the switch is false, or inside their invitation window
while it is true. Nobody is locked out by this order, because the email link
is never closed and a passkey counts as active only after it has worked once.

A suspension or a role revoke does not, today, make every next `/admin/v1/*`
request fail. `evaluateAdminCapability` denies a non-active account (policy
lines 122–124), so a capability route fails on the next call. `GET
/admin/v1/me` does not: `hasAnyInternalRole` allows the request when
`roleKeys` is non-empty (`admin.service.ts` lines 52–59) without looking at
account status. `SessionService.validate` only checks the session document.
Phase 2 requires that the next `/admin/v1/*` request, including `/admin/v1/me`,
fail for a suspended account, with a negative test. No step of this ADR
suspends an account by itself.

## 18. Contract changes and rollout

Contract changes in this ADR:

- The existing `admin-check` and `admin-context` calls gain the credential id
  that created the session (notes 1). The field name is chosen at
  implementation.
- The session record gains the fields in decision 8. Only a passkey session
  stores the credential id that created it.
- Reopening an enrollment window is its own capability in the admin policy and
  its seed. The key name is chosen at implementation.
- Adding or removing a passkey enqueues a notification. That is a new type on
  the notification contract, plus its templates.
- A new internal identity operation provisions the Somnus user at the first
  matching console email-link sign-in (notes 16). Its name is chosen at
  implementation.
- `STAFF_INVITATION_TTL_DAYS`
  (`packages/api-contracts/src/identity/staff-invitation.ts` line 33) changes
  so a new invitation lasts 72 hours, with the switch true or false. Rows
  already pending keep their stored `expiresAt`. One not accepted within 72
  hours must be sent again.

Rollout of the contract: the credential id is added as an optional field, and
identity is deployed first, then edge-api. It is sent only for a passkey
session. While the switch is false, a link session carries none and works as
today, and a passkey session is denied when its credential is inactive. With
the switch true, an admin request that carries no credential id is denied.
This rollout leaves the switch false. If the owner later sets it true, both
services are already deployed.

`CONSOLE_REQUIRE_PASSKEY` has one reader: edge-api. It is not in the
repository today. Edge-api reads its own environment in `EdgeConfigSchema`
(`services/somnus-edge-api/src/config/edge-config.ts` line 16), through
`loadEdgeConfig` (line 139). Identity does not read the switch. It learns the
effect from the request: the credential id, and an explicit flag where one is
needed. A mismatch between the two deployments cannot open or close anything
by itself.

## 19. Operational prerequisites for trust in the domain

These are owner tasks outside the build. This section does not claim the
current state. Before the console origin is treated as a trust anchor: the
registrar account has a strong second factor and a registrar lock; DNSSEC is
on; CAA records are limited to the CA in use; there are no dangling DNS
records and no unused Hosting custom domains; the Google Cloud, Firebase,
GitHub and DNS accounts have a strong second factor; and the Google and Apple
accounts that sync the console accounts' passkeys have strong protection, for
example Advanced Protection or equivalent. Decision 17, phase 6, points here.

