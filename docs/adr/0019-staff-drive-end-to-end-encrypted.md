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
- **Colour and icon** for folders, shared folders, notes, documents and files: stored in the node's sealed
  metadata next to its name, so the server never sees them; kept across renames and new revisions. Only
  the palette's ten colours and the 37 console line icons (`DRIVE_ICONS`) are ever displayed -- anything
  else a member might have sealed is dropped on read. Emoji were tried first and replaced the same day at
  the owner's request ("los emojis se ven poco serios"); an emoji stored meanwhile is no longer shown.

## Addendum -- Markdown preview and spreadsheets (owner decision 2026-10-31)

- **Markdown files open formatted**, in GitHub's dialect (bold, tables, task lists, code), converted in the
  browser (`marked`) and shown in the same `default-src 'none'` frame as a Word preview. Raw HTML in the source
  is shown as text (a `<br>` survives, tables need it), an image becomes its description (fetching it would tell
  an outside server the file was opened), and only http, https and mailto links stay links. This frame alone
  adds `allow-popups allow-popups-to-escape-sandbox`, so a link can open in a new tab; it still runs nothing.
- **Spreadsheets** are a second kind of thing to create, beside documents: a workbook with tabs, formulas,
  formatting, filters and frozen panes (FortuneSheet, MIT). Stored as an ordinary Drive file of type
  `application/vnd.somnus.spreadsheet+json`, same per-file key, block encryption and signatures; every save is a
  new revision and a stale one is refused as a conflict. Export to `.xlsx` (ExcelJS) and CSV happens in the
  browser, loaded only when used. A `.xlsx` or `.csv` previews read-only and can be turned into a Drive
  spreadsheet; the source file stays as it was.
- **The spreadsheet engine never runs in the console's page.** We read its source before adopting it: it writes
  cell text into the page through `innerHTML` with only `<script>` filtered, so a cell holding
  `<img onerror=...>` would run in the tab that holds the Drive's keys, and the console has no CSP. So the engine
  lives in a `sandbox="allow-scripts"` frame: an opaque origin with no cookies, no storage, no reach into the
  parent. Its own policy is `default-src 'none'`, one bootstrap script by hash (no `unsafe-inline`, so injected
  handlers cannot run) and `unsafe-eval`, which the engine needs for row operations and to load itself; no
  connection, no remote image or font. A real-browser test confirmed the policy is what stops it: the engine did
  write the payload into the page, and Chromium refused to run it.
- **What the frame gets and gives back.** It receives one workbook and returns only that workbook, which the
  console checks for shape and treats as data. Only `frame-entry.tsx` may import the engine, and a test enforces
  it. Neither the frame nor the console opens anything on a workbook's say-so: cell hyperlinks, inserted images
  and sheet screenshots are not offered, because they need a way out of the frame.
- `xlsx` parsing runs in the console's page, as Word conversion does: ExcelJS yields plain values and styles,
  which go only to the frame. The legacy binary `.xls` is not read; it can still be downloaded.
- The engine is a single script of about 3 MB fetched only when a spreadsheet opens. `vite dev` serves it in
  pieces the frame cannot load, so spreadsheets need a built console (`vite build`, `vite preview`).
- The server learns nothing new.

## Addendum -- resets and deleting a shared folder (owner report 2026-11-01)

- **A reset is a new identity, and it has a way back.** Changing the passphrase, with the current one or the
  recovery code, re-wraps the same keys: nothing changes for anyone else. A reset makes new keys and takes the
  person out of every folder, so "accept their new key", offered only on a folder's member list, could never be
  reached: the owner saw them flagged as changed with no way to add them. The add form now accepts the new key
  itself, behind the same confirmation of the fingerprint with the person. Trust is still never silent.
- **The directory is read when it matters.** It used to be read once, when the Drive opened, so in a long-lived
  tab a colleague who joined stayed invisible and one who reset was offered with their old key. It is read again
  when the people panel opens, and always before wrapping a folder key (adding a member, rotating on removal). A
  key that changed unseen is refused rather than wrapped.
- **Owners delete a shared folder from its card**, as well as from the bottom of the people panel: the folder's
  name must be typed, or a word when the name cannot be read, so an owner can also delete a folder that no longer
  opens.

## Addendum -- HTML files (owner decision 2026-11-01)

- **An HTML file runs, but never as the console.** A page often is its scripts (the Morpheo engine explainer is a
  self-contained app), so previews that strip them are useless; but opened directly, or from a blob URL, it would
  run in the console's origin, next to the sign-in. It runs instead in a `sandbox="allow-scripts"` frame: an opaque
  origin with no cookies, storage or reach into any other page, in the viewer and in the tab "Open in a new tab"
  gives, which is a script-free holder page plus that frame. It may write to the clipboard, so a page's own copy
  button works, and never read it.
- **Nothing comes in or goes out.** The holder's policy is `default-src 'none'` with inline scripts and styles,
  `unsafe-eval`, and `data:`/`blob:` images and fonts. The frame inherits it from its `srcdoc` parent, so the file
  is not edited and cannot run before the policy is in force. Navigating the frame away is refused too, by the
  policy, which falls back to `default-src` for frames. A hostile file tried in Chromium (remote script, style and
  image, fetch, beacon, WebSocket, form, popup, navigating itself and the top page, reading cookies, storage and
  the parent) reached a listening server zero times.
- **The price:** a page that needs a CDN, a web font, a remote image or an API shows without it, its outbound links
  do nothing, and `localStorage` throws. Download it to use it fully. The tab is a decrypted copy held by a blob URL:
  it is revoked when the file is closed in the Drive, so reloading the tab then fails, though a tab already open
  keeps showing the page after the Drive locks.

## Addendum -- notes on files, and the back button (owner decision 2026-11-01)

- **Notes** go on PDFs, Markdown, Word previews and Drive documents, for the team's working questions. They are
  shared with everyone who can open the folder; anyone who can edit it can write them, and a viewer only reads.
- **The server sees one more file.** Notes live in a companion Drive file (`application/vnd.somnus.notes+json`,
  marked `notesFor` in its sealed metadata) beside the annotated file: same folder key, block encryption and
  signatures, no server change. The session keeps it out of `view.items`, so no listing, search or trash shows it,
  and moves and purges it with its file. A stale revision (two people writing at once) re-reads and reapplies the
  change. The companion is signed as a whole by whoever wrote last, so a note's author is a label among colleagues,
  not proof against a member rewriting the file.
- **Where a note sits.** A PDF note has a page: the browser's own viewer cannot be marked or read from outside, so
  the number is typed, and choosing the note reopens the viewer at that page. Other notes hold their block's first
  words and position; if the text moves the note follows it, and if the text is gone the note says so and stays
  listed rather than attaching itself elsewhere. In a Drive document the highlight is an editor decoration: it is
  not saved, marks nothing as changed, and no export carries it. No export carries notes at all.
- **The preview frame.** A file with no notes keeps the frame that may run nothing. Once it has notes, or the panel
  is opened, the frame also runs one script, named in its policy by hash (no `unsafe-inline`, no `unsafe-eval`), to
  find blocks and draw marks; the frame stays an opaque origin with no connection. The file's content still runs
  nothing: in Chromium a `<script>`, inline handlers, a `javascript:` link, a form and remote images in a preview
  were all refused, and a server listening outside received nothing. What the frame sends back is only a block
  number, checked against the blocks it reported, and their text, used as the note's quote.
- **Back and forward.** An open file is in the URL, but going back only cleared the URL and left the viewer on top.
  Going back now closes the file, or an open note, and forward reopens it.


## Addendum -- more word processor: fonts, colours, dictation and passwords (owner decisions 2026-11-02)

- **Toolbar.** Documents gain font and size, text colour, highlighter, subscript and superscript, clear
  formatting, checklists and list indent. These are TipTap's own extensions at the pinned version; a passage stores
  its colour as `#rrggbb`, its size in points and its font by name, and every export reads them back from there
  (Word runs, PDF runs, inline styles in HTML; Markdown and text keep the words and the tick boxes).
- **Our fonts.** Documents are written in Satoshi by default, and Okine is offered beside it, both served by the
  console from its own Hosting (`/fonts/`). A PDF embeds them; an HTML export carries them as data URLs; a Word file
  names them, so Word shows them where they are installed and its nearest match elsewhere. The owner chose to use
  Okine although the files we hold are named "PERSONAL USE": a commercial licence is the owner's to hold.
- **Dictation waits for AssemblyAI.** A first version used the browser's own speech service (Google in Chrome,
  Microsoft in Edge), outside any contract with us. The owner chose AssemblyAI's EU streaming instead, so this
  release ships without dictation; it comes back with that service.
- **A document's own password.** On top of the Drive's encryption, a document can be sealed with a key derived
  from a password (PBKDF2-SHA256, 600 000 rounds, AES-256-GCM), in the browser, before the Drive encrypts the file.
  Opening it asks for the password; the key stays in memory while it is open and each save seals again with a fresh
  IV. Nobody can recover a forgotten password. The file's name, colour and notes are not covered by it.
- **Passwords on exported files.** A PDF is encrypted by the PDF writer with AES-256 (PDF 1.7 extension level 3,
  revision 5, the newest the writer supports). Revision 5 checks the password with a single SHA-256, so a short
  password falls quickly to an offline guess: the dialog asks for at least 8 characters, and a Word file is the
  stronger choice for anything sensitive. A Word file is wrapped the way Office does it: MS-OFFCRYPTO agile encryption (AES-256-CBC, SHA-512, 100 000 rounds,
  HMAC integrity) in a compound file written with `cfb`. No library did this in a browser, so the format is written
  here, with a synchronous SHA-512 for the 100 000 rounds (checked against WebCrypto in tests). An independent
  implementation (msoffcrypto-tool 5.4.2) opened our file with the password, verified its integrity and rejected a
  wrong password; a test also decrypts it with WebCrypto.

## Addendum -- voice: dictation with AssemblyAI, reading aloud with Google Cloud (owner decision 2026-11-02)

- **Both leave the end-to-end encryption, on purpose.** The owner chose dictation through AssemblyAI and reading
  aloud through Google Cloud Text-to-Speech Neural2 in our own project. Before either starts for the first time
  after a reload, the console says where the words go and asks not to use them for patient data; the acceptance is
  kept in memory only. What comes back -- the dictated text -- is saved encrypted like the rest of the document.
- **Dictation.** The worker holds AssemblyAI's API key (Secret Manager `assemblyai-api-key`, created by hand, read by
  the worker alone) and gives the browser a pass: a token that expires in 60 seconds, for a session of at most 30
  minutes that closes itself after 30 seconds of silence. The browser streams 16 kHz PCM from an AudioWorklet
  straight to AssemblyAI's EU endpoint (`streaming.eu.assemblyai.com`, audio processed in the EU); the audio never
  passes through our servers, which also keeps it clear of Hosting, which buffers whole responses. The model is
  `universal-streaming-multilingual` (es, en, fr, de, it, pt; $0.15 per hour of open stream) with formatted turns;
  Catalan, which it lacks, uses `universal-3-6-pro` ($0.45 per hour). AssemblyAI is a new processor under its DPA.
- **Reading aloud.** The browser sends the passage from the caret (or the selection) a part at a time, at most 4800
  bytes each, through `/admin/v1/drive/speech/read-aloud`; the worker calls Text-to-Speech with its own identity (no
  key), and the MP3 plays in the page while the next part is fetched. The owner chose Chirp 3: HD voices on the EU
  endpoint (`eu-texttospeech.googleapis.com`), so every passage is spoken in the EU. Catalan has no Chirp 3 voice:
  its one voice (`ca-ES-Standard-B`) is on the same endpoint (checked against `voices.list` and a real synthesis on
  2026-11-02, like `es-ES`, `en-GB` and `fr-FR-Chirp3-HD-Kore`). Endpoint and voices are configuration
  (`TTS_ENDPOINT`, `TTS_VOICE_*`).
- **Language.** A selector beside the buttons sets the language for both, defaulting to the console's: a document in
  Catalan can be dictated and read in Catalan from a console in Spanish. The owner confirmed AssemblyAI's DPA, which
  is part of its terms of service.
- **Limits and audit.** Both routes need `admin_drive`, are rate-limited per address (30 dictation passes and 300
  passages per 10 minutes) and emit `admin.drive_dictation.started.v1` / `admin.drive_read_aloud.requested.v1`
  without content. Nothing logs the text or the audio; an upstream failure carries its status code only.
- The console's `Permissions-Policy` now allows the microphone for itself (`microphone=(self)`).


### Word by word, and previews (owner decision 2026-11-02, later the same day)

- **Neural2 replaces Chirp 3: HD for reading aloud.** The owner chose exact word-by-word following over the more
  natural voice: Chirp 3: HD reports no time points (checked: an empty list), Neural2 does. The worker sends each
  passage as SSML with a `<mark>` before every word (the text XML-escaped, so markup in a document is read, never
  obeyed) to `v1beta1/text:synthesize` with `enableTimePointing`, and returns each word's offsets and start time with
  the MP3. A passage too long for every mark within Google's 5000 bytes marks every second (third...) word and places
  the rest between their neighbours. Voices: `es-ES-Neural2-A`, `en-GB-Neural2-A`, `fr-FR-Neural2-F`,
  `ca-ES-Standard-B`, all on the EU endpoint and all reporting time points (checked on 2026-11-02).
- **The page follows the voice.** The document highlights the passage and, every display frame while it plays, the
  word being spoken. Passages are at most 700 characters so every word can carry a mark.
- **Markdown and Word previews read aloud too.** Reading switches the preview to the frame that runs the one hashed
  note script (the same switch opening notes makes; a preview with no notes and no reading keeps the frame that runs
  nothing). The script reports each block's whole text and highlights the passage, and the word through the CSS
  Custom Highlight API, without touching the document. It is told only a block number and two offsets, checked
  against the blocks it reported.
