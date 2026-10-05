# ADR 0018 — Profile photos: a private bucket behind edge-api

- Status: Accepted
- Date: 2026-10-05
- Decides: §9 (Cloud Storage "controlled attachments"), §13 (right to erasure), §21

## Context

Morpheo users get their own space after their first assessment, with a
complete profile that includes a photo. A photo is personal data, and a phone
photo usually carries EXIF metadata, often with the GPS position where it was
taken. The build plan already allows Cloud Storage for controlled
attachments: never public, reached through authenticated endpoints (§9).

## Decision

- **Storage.** A private bucket per environment (`<project>-profile-photos`),
  with uniform access and public access prevention. One object per person,
  named by their opaque Somnus user id. **No versioning and no soft delete**,
  so removing a photo, or the account, removes it for good.
- **Owner.** edge-api is the bucket's only reader and writer
  (`roles/storage.objectAdmin` on that bucket alone). Identity records only
  whether there is a photo and when it changed
  (`individual_profiles.photo_updated_at`). It never sees the bytes.
- **Routes.** `PUT /v1/me/photo` (raw `image/webp` or `image/jpeg` body,
  1 MB, CSRF-protected), `GET /v1/me/photo` (the caller's own only,
  `Cache-Control: private`), `DELETE /v1/me/photo`. Account erasure deletes
  the photo along with the Morpheo data and the identity account.
- **Metadata.** The app crops and re-encodes every photo in the browser
  (512 px, WebP, or JPEG where the browser cannot encode WebP), which keeps
  only the pixels. edge-api does not trust that. It reads the file's
  structure and refuses anything that is not a real WebP or JPEG, or that
  still carries EXIF/XMP.
- **No local fallback in production.** Without `PROFILE_PHOTOS_BUCKET`,
  local development and tests keep photos in memory. A production process
  refuses uploads instead.

Rejected:
- **Firebase Storage from the browser.** The SPA holds no Firebase session
  after sign-in (the edge session is the only session), and security rules
  would be a second authorization system beside identity's.
- **Signed URLs.** They would need `iam.serviceAccountTokenCreator` on
  edge-api's own account. A 1 MB proxy read is cheaper than that permission.
- **Image processing on the server** (e.g. `sharp`). It is a native
  dependency for a job the browser already does. The server only verifies.

## Consequences

- One new dependency in edge-api: `@google-cloud/storage`.
- `GET /v1/me/photo` sends `Cross-Origin-Resource-Policy: same-site` instead
  of helmet's `same-origin`. Deployed, app and API share an origin. Locally,
  they differ only by port, which is still the same site.
