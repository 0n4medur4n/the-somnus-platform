# ADR 0017 — One GCP project per environment; the API same-origin with each SPA

- Status: Accepted
- Date: 2026-10-05
- Supersedes: ADR 0016
- Decides: §2 (deployable map), §5.1/§5.2 (Hosting), §10 (session cookie)

## Context

Dev ran in two GCP projects: the backend in `the-somnus` and Firebase
(Hosting, Authentication) in `the-somnuss`. Nothing chose that split — the
Firebase project existed first. It caused three incidents: the session
Firestore pointed at the wrong project; a Hosting site cannot reach Cloud
Run in another project, which forced the separate `api.thesomnus.com`
front door of ADR 0016; and the Firebase console showed two projects with
the same display name. Google's and Firebase's guidance is one project
per environment.

## Decision

Everything for an environment lives in one project — for dev,
`the-somnus`: Cloud Run, Secret Manager, Firestore, Authentication (via
Identity Platform, email link only), the Firebase web app, and the three
Hosting sites (`thesomnus-web`, `thesomnus-app`, `thesomnus-console`).

Because Hosting and Cloud Run now share a project, the app and console
sites rewrite `/v1/**` to `somnus-edge-api` (firebase.json). The SPAs call
`/v1/...` on their own origin (`VITE_EDGE_API_URL: "same-origin"`). The
session cookie `__session` is therefore same-origin first-party in every
browser, including Safari and iOS in-app browsers, and there is no CORS on
the SPAs' requests.

CI deploys Hosting as `ci-hosting-deployer` through Workload Identity
Federation: no service-account key exists.

Staging and production are each created as a single project from the
start.

## Consequences

- `api.thesomnus.com` (ADR 0016) is retired once the custom domains move.
  The `__session`-only cookie and session-bound CSRF it required stay: they
  are what Hosting rewrites need on any site.
- The project's auth domain is `the-somnus-30c48.firebaseapp.com`: the
  plain name belongs to an unrelated Firebase project. Authorized domains
  are derived from the web app config, never hand-written.
- Migration: edge-api briefly accepts ID tokens from both projects
  (`FIREBASE_PROJECT_ID` as a list, each token verified only by the
  project its `aud` names); users are copied with their UIDs so
  `user_identities` stays valid; the custom domains move last.
- `the-somnuss` is removed from Terraform after the move and can then be
  deleted.
