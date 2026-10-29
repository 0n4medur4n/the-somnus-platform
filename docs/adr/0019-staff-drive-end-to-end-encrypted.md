# ADR 0019 — The staff Drive: end-to-end encrypted, in the worker

- Status: Accepted (owner decisions, 2026-10-17 and 2026-10-18)
- Date: 2026-10-17; storage revised 2026-10-18
- Decides: §2 and §5.7 (a third isolated module in `somnus-worker`), §9 (a
  private Cloud Storage bucket for it, no database), Addendum A §A2.2 (a new
  capability row)

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
- **Placement.** An isolated `drive` module in `somnus-worker`, reached only
  through `/admin/v1/drive/*` on edge-api, behind `admin_drive` (every internal
  role) and the admin audit interceptor. Max 20 MiB per file.
- **Storage (owner decision 2026-10-18): one private Cloud Storage bucket, no
  database.** `<project>-staff-drive` in `europe-west3`: uniform access,
  public access prevention, no versioning, soft delete off (a delete is final,
  and nothing deleted keeps costing). The worker's service account holds
  `roles/storage.objectAdmin` on that bucket alone and needs no credential.
  Layout: `accounts/{user}.json`; `shares/{share}/manifest.json` (key
  generation, members, nodes, pending uploads); `shares/{share}/blocks/...`;
  `memberships/{user}/{share}` as an index. The manifest is replaced only with
  a compare-and-swap on its generation (`ifGenerationMatch`), and every rule is
  checked inside that swap, so a rotation is one atomic write and two people
  acting at once cannot both pass a check meant for one. The index is written
  before an add and removed after a removal, so it may over-report, never
  under-report; the manifest always decides.
- **Lost secrets.** Recovery code → new passphrase and a new code. Both lost →
  reset: new keys; folders nobody else holds are deleted, ownerless folders get
  their longest-standing member as owner.

Rejected: a module in identity (adds file traffic to the service that
authorizes every request); a TiDB logical database (the owner chose against
TiDB for the Drive: it needs a database user and a password secret, and stores
blobs where object storage is cheaper); Cloudflare R2 (free up to 10 GB, but a
new processor, an API key in Secret Manager and a new SDK, against a cost
difference of cents);
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
- Cost: Standard storage in `europe-west3` (~0.023 USD per GB-month) plus
  operations at fractions of a cent per thousand; traffic to Cloud Run in the
  same region is free. A few GB of team documents cost cents a month.
- Deploy is Terraform (the bucket, its IAM, `DRIVE_BUCKET` on the worker) and
  the images; there is no secret and no migration
  (see `docs/runbooks/deploy-dev.md`).

## Addendum -- documents, previews and the Drive's own tab (owner decision 2026-10-19)

- **The Drive opens in its own tab** (`/drive` on the console's site), full window, without the
  console's sidebar; folder, trash and open document live in the URL so back and forward work. Same
  gate as the console plus `admin_drive`. Keys stay in that tab's memory only.
- **Previews are produced in the browser from the decrypted bytes**: a PDF goes to the browser's
  own viewer through a blob URL; a Word file is converted to HTML (mammoth) and shown in a sandboxed
  frame with no `allow-*` tokens and a `default-src 'none'` policy, so it can run nothing.
- **Documents**: a rich-text page written in the Drive (TipTap, composed extension by extension;
  links only http/https/mailto). Stored as an ordinary Drive file of type
  `application/vnd.somnus.document+json` -- same per-file key, block encryption and signatures --
  and every save is a new revision (a stale revision is refused as a conflict, never overwritten).
  Exports to Word, PDF, HTML, Markdown and plain text are made in the browser (docx, pdfmake loaded
  only on export; the PDF writer may fetch nothing). A `.docx` can be turned into a document.
- The server learns nothing new: no format conversion, preview or export ever leaves the browser.

## Addendum -- links, colours and icons (owner decision 2026-10-29)

- **Internal links only.** "Copy link" gives a `/drive?share=…&folder=…&file|doc=…` address: opaque ids,
  never a name or a key. It opens the item for someone who already has access to that folder, after they
  unlock their own Drive; anyone else sees "no access". Public links for people outside The Somnus were
  explicitly not chosen -- they would break the staff-only rule and need a separate security review. A
  link opened while signed out survives sign-in (the `/drive` path only, 30 minutes, ids only).
- **Colour and emoji** for folders, shared folders, notes, documents and files: stored in the node's sealed
  metadata next to its name, so the server never sees them; kept across renames and new revisions. Only
  the palette's ten colours and a single pictographic emoji are ever displayed -- anything else a member
  might have sealed is dropped on read.
