# ADR 0021 — Morpheo invitations from the console

- Status: Accepted (owner approval in this session, 2026-10-19)
- Amends: Addendum A §A1 and Checkpoint 15.2

The superadministrator may invite individual adults and professionals to
Morpheo, choosing the email language (es/en/ca/fr). The new `admin_users_invite`
capability belongs only to `platform_super_admin`, evaluated in Identity. An
email address written in source code never confers authority.

`platform_invitations` belongs to `somnus_identity`. Invitations expire after
seven days; replacement revokes the previous pending invitation; revocation,
expiration and reuse fail closed. The application receives an opaque locator,
not an authorization token: lookup and acceptance always use the verified
session address supplied by edge. The issuer must still hold the capability.

New users complete the normal registration fields and separate consents
themselves. Identity atomically prepares the account and profiles, initially
suspended; it records missing consent receipts through ConsentService's public
interface, then atomically accepts the invitation and activates the account.
Failure leaves the invitation pending and the account suspended, so a retry can
finish without duplicating it. A replacement can carry that prepared account
forward only with the same branch and email language. Revoked or expired
invitations do not activate a prepared account. Existing active accounts retain
their profile, language, consent records and permissions.

An invited professional receives a pending verification profile and case,
never a professional-role assignment. No invitation grants access to Nox.
The owner's requirement that Nox be physician-only is recorded for its future
authorization design; Nox is not implemented by this decision. Existing internal
staff invitations and organization invitations keep their distinct boundaries.

The admin detail includes registered profile/contact information, professional
standing, assigned roles with scope, memberships and dates. It does not include
health answers or reports; existing break-glass controls remain required.
Admin actions and acceptance emit audited events with opaque ids, without
addresses, names, tokens, links or health data in event payloads.

The existing edge → Cloud Tasks → worker → Brevo transport and four email
locales are reused. No new dependency, service, product entitlement, secret or
warm instance is introduced. Hosting waits for every CI validation job. API
documents are generated from Zod, and the changed service documents are tracked.
