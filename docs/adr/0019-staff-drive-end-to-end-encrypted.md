# ADR 0019 — The staff Drive: end-to-end encrypted, in the worker

- Status: Accepted (owner decision, 2026-10-17)
- Date: 2026-10-17
- Decides: §2 and §5.7 (a third isolated module in `somnus-worker`), §3.9 (a new
  logical database `somnus_drive`), Addendum A §A2.2 (a new capability row)

## Context

Internal staff need one place to share protocols, rules, algorithms and usage
instructions, with folders and notes, inside the admin console. The owner asked
for it to be secure "like Proton": the platform itself must not be able to read
what staff keep there.

## Decision

- **End-to-end encrypted, in the browser, on WebCrypto only.** No new
  dependency. Every name, note and file is encrypted before it leaves the
  console; the server stores ciphertext, public keys and folder membership.
- **Keys.** Each person sets a Drive passphrase (separate from the magic link,
  never sent). PBKDF2-SHA256 (600 000 iterations, the contract's floor) wraps a
  random account key; a 160-bit recovery code wraps it too (HKDF). The account
  key seals the person's ECDH P-256 (receiving) and ECDSA P-256 (signing)
  private keys. Each shared folder has an AES-256 key per *key generation*,
  wrapped for each member by ECDH with a fresh ephemeral key + HKDF, and signed.
  Each folder/file has its own key, wrapped under the folder key; it seals the
  node's metadata and every 512 KiB content block. Every AES-GCM seal binds its
  context (folder, node, revision, block index and count) as associated data.
- **Removal rotates.** Removing a member (or leaving) sends, in one request, a
  new folder key for exactly the remaining members and every node key rewrapped
  under it; the worker refuses an incomplete rotation.
- **Authenticity.** Folder-key copies and node revisions are signed. A member
  re-signs their own copy on first open, so their access no longer depends on
  the granter's keys. Colleague keys are pinned on first use and shown as
  fingerprints; a changed key is flagged and is not used until accepted.
- **Placement.** An isolated `drive` module in `somnus-worker`, logical database
  `somnus_drive`, own migrations; reached only through `/admin/v1/drive/*` on
  edge-api, behind `admin_drive` (every internal role) and the admin audit
  interceptor. Blocks are stored in the database (`MEDIUMBLOB`), max 20 MiB per
  file, no new bucket.
- **Lost secrets.** Recovery code → new passphrase and a new code. Both lost →
  reset: new keys; folders nobody else holds are deleted, ownerless folders get
  their longest-standing member as owner.

Rejected: a module in identity (adds file traffic to the service that
authorizes every request); Cloud Storage for blocks (new Terraform and signed
URLs for ciphertext that gains nothing from a bucket at this size);
server-side escrow by a super admin (breaks end-to-end encryption); Argon2id
(needs a WASM dependency; PBKDF2's parameters are recorded per wrap and can be
raised later).

## Consequences

- The server sees the tree's shape, sizes, timestamps, who belongs to which
  folder, and audit events with opaque ids -- the same metadata Proton Drive
  exposes. It cannot read names or content and cannot forge a folder key.
- It could still roll a file back to an older revision it kept, or show a
  member a stale tree; it cannot alter content undetected.
- Account deletion (`DELETE /v1/me`) erases the person's Drive identity and
  memberships through `POST /internal/v1/drive/account/erase`.
- The Drive is not for patient data; the console says so. It is outside §15's
  scope: no model ever sees it.
- Deploy needs a `somnus_drive` database and user, a `drive-db-url` secret
  mounted as `DRIVE_DATABASE_URL` on the worker, and its migrations applied
  (see `docs/runbooks/deploy-dev.md`).
