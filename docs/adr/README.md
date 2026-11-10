# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for
The Somnus platform. Each ADR captures one significant decision in one
page, with a status, a date, the build-plan section it implements, and
the consequences.

## Index

| # | Title | Status | Build-plan section |
|---|-------|--------|--------------------|
| 0001 | One Cloud Run service per bounded context | Accepted | §2, §5 |
| 0002 | Monorepo with independent deployments | Accepted | §2, §6 |
| 0003 | Each service and isolated module owns its data | Accepted | §7, §8, §9 |
| 0004 | NestJS 11 + Fastify 5 for transactional services | Accepted | §3.4 |
| 0005 | Python 3.x + FastAPI for Morpheo, data, and controlled AI | Accepted | §3.5, §3.6 |
| 0006 | Firebase authenticates, The Somnus authorizes | Accepted | §10, §11 |
| 0007 | Morpheo is independent from identity and the worker | Accepted | §5.5, §14, §15 |
| 0008 | Internal services are private, edge API is the only public surface | Accepted | §2, §5.3, §21 |
| 0009 | Static frontends on Firebase Hosting (Astro marketing, Vite+React SPA) | Accepted | §3.1, §3.2, §5.1, §5.2 |
| 0010 | Five-service map with isolated modules, not more | Accepted | §2, §5.4, §5.7 |
| 0011 | Pinned technical decisions | Accepted | §3, §18, §2 |
| 0012 | Four-locale i18n from day one (es, en, ca, fr) | Accepted | §3.3, §22 |
| 0016 | Same-site API front door through Firebase Hosting | Superseded by ADR 0017 | §10, §21 |
| 0017 | One GCP project per environment; the API same-origin with each SPA | Accepted | §2, §5.1, §5.2, §10 |
| 0018 | Profile photos: a private bucket behind edge-api | Accepted | §9, §13, §21 |
| 0019 | The staff Drive: end-to-end encrypted, in the worker | Accepted | §2, §3.9, §5.7, Addendum A §A2.2 |
| 0020 | The embudo v0.2 is the Morpheo flow that prevails | Accepted | §14, §14a, §15 |

| 0021 | Morpheo invitations and administrative user detail | Accepted | Addendum A, 15.2 |
| 0022 | The one-page patient report, and sources authorised by the owner | Accepted | §14, §15, Addendum B §B4 |
| 0028 | Mi Sueño: scope and Retos (goals and badges); only the Retos section is written | Proposed | Addendum B, §B.9 |
| 0024 | A case record for every Morpheo interview | Accepted | §13, §14, Addendum A §A2.2–§A2.4 |
| 0025 | Account deletion leaves no sign-in data behind; no third-party AI reads patient text | Accepted | §13, §15 |
| 0026 | Dictation of Morpheo free-text answers through AssemblyAI (EU) | Accepted | §14, ADR 0019, ADR 0025 |
| 0027 | Passkeys for the admin console | Accepted | §10, §11, §21 |

## Convention

- File name: `NNNN-kebab-case-title.md`.
- One page maximum.
- Status values: `Proposed`, `Accepted`, `Superseded by ADR NNNN`.
- A new decision that contradicts an Accepted ADR must either
  supersede it (preserve history) or live alongside it as a
  `Proposed` ADR with rationale.

## Cross-references

- Build plan and prompt sequence: private repository `the-somnus-internal`
  (see [`../build-progress.md`](../build-progress.md#private-repositories))
- Environment deviations: [`../environment-baseline.md`](../environment-baseline.md)
