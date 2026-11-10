# ADR 0027 — Passkeys for the admin console
- Status: Accepted (effective when this PR merges)
- Date: 2026-11-05
- Revised: 2026-11-07, 2026-11-10
- Amends: ADR 0006 for the console's proof only. The app stays on the email link.
- Decides: §10, §11, §21
- Detail: [notes](0027-passkeys-for-the-admin-console-notes.md) (where notes N is cited below)

## Decision
1. **Scope.** Console only. The app keeps the email link, exactly as today for everyone, with or
   without a passkey, in the app and the console. A passkey never blocks, shortens or changes it;
   it is an extra console sign-in and the proof for critical actions. The switch stays false
   (decision 9, notes 17).
2. **Verification.** Identity verifies WebAuthn with `@simplewebauthn/server` (stable version pinned
   at implementation, §18). No custom token. No `iam.serviceAccounts.signBlob`.
3. **Mint.** Identity confirms the assertion and returns the Somnus user id and the Firebase uid.
   It refuses a non-active account, so no session is created. An active account with no role may
   still sign in, to accept. Edge-api creates the session with no Firebase ID token (notes 2, 13).
4. **Authenticators.** Synced platform passkeys (iCloud Keychain, Google Password Manager, Windows
   Hello), plus QR. No hardware key. AAL2. Attestation `none`.
5. **Relying party.** `rpId` `console.thesomnus.com`. Origin exactly `https://console.thesomnus.com`
   (no wildcard; localhost only in development, never production). Any other origin, `crossOrigin`
   or another top origin is rejected. `userVerification` and `residentKey` required. Conditional UI
   where supported. ES256, EdDSA, RS256. A request is console only when Origin equals that URL
   exactly (never a prefix, suffix or pattern) and, when sent, `Sec-Fetch-Site` is `same-origin`.
   A non-browser can forge these headers, so they are not the barrier. The barrier is server-side
   state (decision 9's checks, decision 11's step-up, passkey `amr` when the switch is true) and
   the assertion check against that exact origin and rpId (notes 16).
6. **Challenges.** 32 random bytes, single use, five minutes, new identity table (Drizzle). Identity
   builds the options and verifies; edge-api only proxies. One conditional `DELETE` consumes a
   challenge (id matches, not expired, one row). Creating one also deletes expired rows, bounded.
   No scheduler, no worker endpoint, no Terraform (notes 3).
7. **Credentials.** Columns in notes 9. A credential stays pending until its first successful
   passkey sign-in, and a pending one cannot step up or count as active. A non-zero sign count
   that does not increase locks it and raises an audit event. A count that stays zero does not.
8. **Console sessions**, however started: idle 30 minutes, absolute 10 hours, `__session`, `Secure`,
   `HttpOnly`, `SameSite=Strict`, no `Domain`. The only visible change for a console link sign-in,
   and it never lengthens a session. App sessions keep `SameSite=Lax` and 7 days. Classification:
   decision 5, notes 16. `/admin/v1/*` answers only console sessions, whatever the switch. An
   app-origin link session is refused there. A console-origin link sign-in is unchanged.
   Fields: `client`, `amr`, `authTime`, `lastSeenAt`, `stepUpAt`, and, on a passkey session, the
   credential id that created it. `lastSeenAt` at most once a minute. A removed, revoked or locked
   passkey ends the sessions created with it at the next request. Link sessions carry no credential
   and are not affected. Identity does not write Firestore. Sign-out of all console sessions stays
   in edge-api (notes 1). With the switch true, `/admin/v1/*` requires `amr` = passkey.
9. **Enrollment.** Alone, from a console-origin link session (notes 4, 16). Before a credential: the
   link is under 10 minutes, the account is active, the verified email equals the user's, and the
   user has an internal role or a matching pending invitation. Zero active passkeys; a second needs
   step-up. Add and remove email the owner, with no access link. A super admin never registers one
   for someone else, never sees credential material, and may only revoke after step-up. Switch
   false: the mailbox still opens non-critical console work; it cannot do critical actions or add a
   passkey once one is active. Every new staff invitation lasts 72 hours, switch true or false
   (`STAFF_INVITATION_TTL_DAYS`, `staff-invitation.ts` line 33). Pending rows keep `expiresAt`.
   One not accepted within 72 hours must be sent again. Setting the switch true is not this
   rollout. Switch true only: a 15-minute window, zero active passkeys, the 2026-11-07 rules, an
   invitation window as long as the invitation (72 hours), and `enrollment_refused` (notes 4, 16).
   An app-origin session never registers a passkey and is refused on `/admin/v1/*` (decision 8);
   with the switch true it cannot accept staff, and those routes need passkey `amr` (notes 14, 16).
10. **CSRF.** Pre-session passkey login routes join the explicit exemption list (`isCsrfExempt`), as
    `POST /v1/sessions` does. Register, rename, remove and step-up require CSRF. Negative test:
    `csrf-exempt-routes.test.ts` (notes 5).
11. **Step-up.** Once a person has an active passkey, critical actions need a fresh user-verified
    assertion of that person (`stepUpAt` under 5 minutes) and CSRF, in a link session or a passkey
    session: `admin_break_glass`, `admin_roles_assign`, `admin_audit_export`, `admin_corpus_manage`,
    `admin_deletion_requests_process`, reopening or revoking passkeys, suspending or reactivating
    (`admin_account_status_write`, policy line 35), creating a staff invitation (same file line 48),
    and adding or removing a passkey. With no active passkey, those actions work as today. A link
    session needs no passkey to read or do non-critical work. Reopen is its own capability, super
    admin only; name chosen at implementation. `stepUpAt` does not move `authTime`. UX: notes 12.
12. **Order.** Notes 17. The link stays open. A passkey is active only after it has worked once.
13. **Accounts.** One person per console account, so the audit names that person. The owner is
    responsible. `platform_super_admin` goes to two existing user ids from the role-holder check
    (notes 8), never by typing an email into an invitation. Other holders are revoked after those
    two enroll. No step suspends an account. Option A stands (notes 7). Bootstrap is not reopened.
14. **Recovery.** No self-service reset. After another channel, the route needs step-up and the
    capability (phase-6 runbook). The domain operation revokes the user's passkeys (which ends the
    console sessions created with them, notes 1) and writes the audit events; with the switch true
    it also opens the enrollment window. The other super admin calls the route, or the owner script
    calls the operation, not SQL, with its own marker, not `assignedBy` null (notes 4). Neither
    depends on who owns the accounts. The switch stays. The bootstrap is not weakened.
15. **Preview channels.** Reject a preview origin. Tests stay local. Visual checks only (notes 6).
16. **Hardening.** CSP is `Content-Security-Policy-Report-Only` until console sign-in and the
    email-link callback show no violations, then enforced; it must allow that callback's Firebase
    endpoints. The owner and each operator read violations in the browser console. No report
    endpoint (notes 11). `frame-ancestors 'none'`, `publickey-credentials-get=(self)`,
    `publickey-credentials-create=(self)`. Dictation stays, so `microphone=(self)` stays. Per-IP
    limits. Audit events have no free text, plus credential id and holder when one exists.
    `enrollment_refused` if switch is true. Never log challenges, assertions, attestations, cookies.
17. **Delivery.** (1) this ADR (2) backend: notes 13, staff routes (notes 14), reopen in policy and
    seed (3) console UI (notes 12) (4) Terraform on existing services; the switch stays false. No
    new resources. Headers and CSP are a pull request (5) notes 17 (6) guide, runbook, DPIA, notes
    19. Before patients and the script: identity's least-privilege user, rotation, secret review
    (notes 4). Done when a person activates a passkey alone in a few minutes, the link still works,
    critical actions need a fresh assertion, audits name a person, and recovery was tested once.

## Open questions
1. **Open item.** Notes 8: known holders; revoke unknowns. One `platform_admin` is unaccounted for.

## Consequences
No new deployable. No Terraform for challenges. DPIA before a later switch (notes 15, 18).
