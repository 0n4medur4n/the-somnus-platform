# The Somnus

**Digital sleep health.** Understand your sleep. Make better decisions.

[![CI](https://github.com/0n4medur4n/the-somnus-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/0n4medur4n/the-somnus-platform/actions/workflows/ci.yml)

The Somnus is a digital health company focused on sleep. This repository holds
the whole platform: the public website, the application for people, the
internal console for the team, and the services behind them.

Its first product is **Morpheo**.

## What Morpheo is

Sleeping badly does not always have the same cause. Waking up at night,
tiredness, trouble falling asleep or unrefreshing sleep can look like the same
problem and not be. Morpheo is a guided interview for **adults** who sleep
badly. It helps them put in order what is happening, understand which pattern
may be behind it, and know what a reasonable next step is, with a clear report
they can take to their healthcare professional.

Morpheo is an **orientation** tool, not a diagnostic one.

- It does not diagnose or rule out disease.
- It does not prescribe or adjust treatment.
- It does not decide on its own whether a test or a referral is needed.
- It does not replace a healthcare professional.

A reassuring result only means that, with the information available, no signal
asking for earlier action came up. It never means there is nothing.

### What an assessment looks like

1. **Protection questions first.** Before anything else, the system checks for
   situations that cannot wait. Sleep medicine has almost no emergencies; the
   two real priorities are suicidal ideation and drowsy driving. The tone is
   calm, never alarmist.
2. **One question per screen.** A simple path, with branches that open only
   when they are needed.
3. **The person tells their story in their own words.** An AI proposes what it
   understood ("From what you have told us, we understand...") and **the person
   confirms or corrects it** before the engine uses any of it.
4. **Rules, not models, decide.** A deterministic engine applies the clinical
   rules and chooses the orientation.
5. **A report.** One page for the person and one to hand to their professional,
   with the facts that triggered each orientation, what is unknown, what is
   worth preparing, and the limits of the result. It is shown on screen and can
   be downloaded as a PDF.

The same set of answers always produces the same result.

### Validated questionnaires

The engine is ready to offer ISI (insomnia), Epworth (sleepiness) and STOP-Bang
(sleep apnoea) as an optional complement that never decides on its own. They
are switched on only from the official files of the validated Spanish versions,
with their licence.

## Who uses it

| Who | Where | What they do |
|-----|-------|--------------|
| Adults | [app.thesomnus.com](https://app.thesomnus.com) | Take the assessment, see their history in "Mi espacio", download their report |
| The public | [thesomnus.com](https://thesomnus.com) | Learn about The Somnus and Morpheo; legal texts; in four languages |
| The Somnus team | Internal console | User management and professional verification, content review, the clinical source library, statistics, audit, and an end-to-end encrypted Drive |

Healthcare professionals and organisations are part of the platform's model
(verification, roles, invitations, access only with explicit consent) and will
be opened up in phases.

## How it is built

A small platform that is cheap to run and has clear boundaries: **three static
frontends** and **five independent services** on Google Cloud Run.

```text
Internet
   |
   +--> Firebase Hosting
   |        +--> somnus-marketing   Astro, static          thesomnus.com
   |        +--> somnus-app         Vite + React           app.thesomnus.com
   |        +--> somnus-admin       Vite + React           internal console
   |
   +--> somnus-edge-api             NestJS, public
              |
              +--> somnus-identity-service   NestJS, private
              |        includes the isolated Consent module
              +--> morpheo-service           Python, private
              +--> somnus-report-service     Python, private
              +--> somnus-worker             NestJS, private
                       includes the isolated Notification,
                       Audit and Drive modules
```

| Service | Responsibility |
|---------|----------------|
| [`somnus-edge-api`](./services/somnus-edge-api) | The only public door. Sessions, CSRF, CORS, rate limits and composition. It touches no database |
| [`somnus-identity-service`](./services/somnus-identity-service) | Users, profiles, organisations, roles and **every authorization decision**. Hosts the Consent module, with its own database |
| [`morpheo-service`](./services/morpheo-service) | The clinical engine: the interview, the rules, the orientation categories and the versioned clinical artifacts |
| [`somnus-report-service`](./services/somnus-report-service) | HTML and PDF reports, controlled wording, the clinical source library and its search |
| [`somnus-worker`](./services/somnus-worker) | Email, audit, scheduled jobs (such as automatic deletion) and the team's Drive |

Shared code lives in [`packages/`](./packages): contracts (Zod), errors,
configuration, observability, internationalisation, the design system and the
internal service client.

### Principles that are not negotiable

- **Firebase authenticates. The Somnus authorizes.** Firebase says who you are;
  `somnus-identity-service` always decides what you may do. Administering an
  organisation does not grant access to clinical data.
- **Every service owns its data.** One logical database per service and per
  isolated module, on TiDB Cloud. Nobody reads another's tables.
- **AI decides nothing clinical.** It never scores, refers or sets urgency. It
  extracts data from the story the person confirms, writes with already approved
  wording, and cites sources. Everything it says goes through a forbidden-phrase
  filter and a bounded schema; if either fails, the approved text is shown.
- **Clinical content is a versioned source of truth.** The questions, rules and
  texts live in `services/morpheo-service/clinical/`, a submodule of a private
  repository, with their own changelog. The code applies them; it does not
  rewrite them.
- **Privacy by design.** No names or identifiers in the interview; no health
  data in logs or emails; unclaimed anonymous assessments are deleted after 30
  days and claim links expire after 72 hours; anyone can delete their account
  and data.
- **Cost first.** Every service scales to zero instances. Cold starts are the
  price of keeping the platform cheap.
- **Four languages.** The interface is in Spanish (default), English, Catalan
  and French; a key missing in any of them breaks continuous integration. The
  internal console is in Spanish and English. Today the clinical interview is
  written in Spanish.
- **Contracts are written once.** Zod is the source of truth; OpenAPI and the
  JSON schemas are generated, never written by hand.

## Technology

| Layer | Tools |
|-------|-------|
| Frontends | Astro, Vite, React, TypeScript, Tailwind CSS, TanStack Query, i18next |
| Platform services | Node.js 24, NestJS 11 with Fastify 5, Drizzle ORM, Zod 4 |
| Clinical engine and reports | Python 3.13, FastAPI, SQLAlchemy 2, Alembic, WeasyPrint, `uv` |
| Data | TiDB Cloud (MySQL protocol), Firestore (temporary session state only), Cloud Storage, BigQuery (analytics without personal data) |
| AI | OpenAI API behind a provider abstraction layer, with `store: false` on every call |
| Identity and email | Firebase Authentication with an emailed sign-in link, no passwords; Brevo |
| Infrastructure | Google Cloud (europe-west3), Terraform, GitHub Actions |
| Quality | Biome, Ruff, mypy, Vitest, pytest, Playwright, dependency-cruiser |

## Status

The platform is **running and in a pre-launch phase**: the application, the
console and the public website are deployed, and the current clinical engine
(the v0.2 funnel) is the active flow. Before opening it to real patients, some
production and regulatory-compliance tasks remain; the open-items list and the
data protection impact assessment are kept in the private internal repository
(see "Private material").

Any clinical content the clinical team has not approved is marked as a draft
and is never presented as approved.

## Repository layout

```text
apps/              somnus-marketing · somnus-app · somnus-admin
services/          edge-api · identity · morpheo · report · worker
packages/          contracts, errors, configuration, i18n, design, observability...
schemas/           generated JSON schemas and OpenAPI
infrastructure/    Terraform (modules and environments)
docs/              ADRs and development guides
scripts/           development and CI utilities
```

## Local development

Required tools and exact versions: [`docs/environment-baseline.md`](./docs/environment-baseline.md).

```bash
pnpm install          # workspace dependencies
just dev-up           # MySQL 8 and Firebase emulators in Docker
just ci               # format, lint, types, tests and build
just dev-down         # stop the environment
```

The Python services are tested from their folder with `uv run ruff check .`,
`uv run mypy src` and `uv run pytest`. The working rules, the quality gate and
the conventions are in [`docs/build-progress.md`](./docs/build-progress.md).

## Documentation

| What | Where |
|------|-------|
| Build progress, layout and development guide | [`docs/build-progress.md`](./docs/build-progress.md) |
| Architecture decisions | [`docs/adr/`](./docs/adr/README.md) |
| Each service and each app | the `README.md` in its folder |
| Build plan, operations (deploys, backups, incidents), security, threats and impact assessment | private repository `the-somnus-internal` |
| Clinical content and its changelog | private repository `the-somnus-clinical` |

## Private material

Part of the documentation and all of the clinical content live in two private
repositories and are not published here:

- `the-somnus-clinical` is the submodule `services/morpheo-service/clinical/`.
  After cloning: `git submodule update --init`.
- `the-somnus-internal` is cloned into `internal/` (ignored by git):
  `git clone git@github.com:0n4medur4n/the-somnus-internal.git internal`.

Access to both is needed to build and test `morpheo-service`. CI fetches the
clinical submodule with a read-only deploy key.

## Notice

Morpheo provides orientation and educational information. It does not make
diagnoses and does not replace a healthcare professional. In an emergency,
call **112**.
