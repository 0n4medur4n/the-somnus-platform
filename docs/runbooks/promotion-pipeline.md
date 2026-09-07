# Runbook: promotion pipeline

Build plan **Checkpoint 13.3**. The promotion pipeline builds each changed
deployable **once** and promotes that exact artifact through the environments:

```
PR → CI (ci.yml) → merge to main
        → build-push (changed services only, one image each)
        → deploy dev          (automatic)
        → deploy staging       (gated: approved promotion)
        → deploy production    (gated: manual approval)
```

Implemented by [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)
(orchestrator: change detection + build) and
[.github/workflows/deploy-environment.yml](../../.github/workflows/deploy-environment.yml)
(reusable per-environment deploy). Only the deployables whose files changed since
the previous commit build and deploy; a change to shared TS packages/the lockfile
rebuilds the TS services, and a change to the JSON-schema artifacts rebuilds the
Python services (conservative — over-deploying is a no-op, under-deploying ships
stale code).

**Until it is configured, the pipeline no-ops (green).** The `detect` job checks
the repo variable `ARTIFACTS_PROJECT_ID`; if unset it prints a notice and skips
all build/deploy jobs, exactly like ci.yml's Hosting deploy skips without
`FIREBASE_SERVICE_ACCOUNT`. Nothing here can touch a real project until you
complete the steps below.

### Which deploy path is actually running today

Read this before concluding anything about how a live site got there.

**Everything on Firebase Hosting today is deployed by ci.yml's `deploy-hosting`
job**, not by this pipeline. That job authenticates with the
`FIREBASE_SERVICE_ACCOUNT` repository secret (a service-account JSON key, not
WIF), and builds and deploys **all three sites** -- marketing, app and admin --
to the `the-somnuss` Firebase project on every push to `main`. A pull request
gets a preview channel instead. That includes app.thesomnus.com.

**`deploy.yml` + `deploy-environment.yml` -- the WIF promotion pipeline described
in this document -- are dormant.** The `detect` job skips every downstream job
while the repository variable `ARTIFACTS_PROJECT_ID` is unset, so `build-push`
has never run and `BUILD_WIF_PROVIDER` / `BUILD_WIF_SERVICE_ACCOUNT` have never
been read. Those secrets not existing yet is expected, not a fault.

Until `ARTIFACTS_PROJECT_ID` exists, the ci.yml path above is the **only** deploy
path in use. Setting that variable is what switches the pipeline on, and is a
deliberate decision, not a step to take while configuring something else.

---

## 1. Authentication: Workload Identity Federation (keyless)

No service-account JSON keys in GitHub. Create a Workload Identity pool + a
provider trusting this repository, and bind service accounts to it.

- **Build SA** (repo-level): write access to the shared artifacts registry only
  (`roles/artifactregistry.writer` on `ARTIFACTS_PROJECT_ID`).
- **Deploy SA, one per environment**: on that environment's project —
  `roles/run.admin` (deploy Cloud Run), `roles/iam.serviceAccountUser` (act as
  the runtime SAs), `roles/firebasehosting.admin` (deploy Hosting); and
  `roles/artifactregistry.reader` on `ARTIFACTS_PROJECT_ID` (pull the promoted
  image). No owner/editor/IAM-admin — the least-privilege CI check (Checkpoint
  13.1) and build plan §21 forbid it.

Bind each SA to the pool with a `principalSet` restricted to this repo (and, for
production, ideally to the `main` ref / the `production` environment).

## 2. Shared artifacts registry (build once, promote the same bytes)

Images are built once and pulled by every environment, so staging and production
run the exact bytes that passed dev. Pick one project to hold the registry
(`ARTIFACTS_PROJECT_ID`) — it can be the dev backend project or a dedicated
artifacts project — and grant every environment's deploy SA
`roles/artifactregistry.reader` on it. The `somnus` Artifact Registry repo
already exists there (the `artifact-registry` module).

## 3. GitHub configuration

**Repository variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Example | Used by |
|----------|---------|---------|
| `ARTIFACTS_PROJECT_ID` | `the-somnus` | build-push + all deploys (also the on/off switch) |
| `ARTIFACTS_REGION` | `europe-west3` | build-push + all deploys |

**Repository secrets:**

| Secret | Meaning |
|--------|---------|
| `BUILD_WIF_PROVIDER` | Full WIF provider resource name for the build SA |
| `BUILD_WIF_SERVICE_ACCOUNT` | Build SA email |

**Per-environment configuration** — create three GitHub Environments: `dev`,
`staging`, `production`. Each carries its **own** variables and secrets, so the
same workflow deploys to a different GCP project per stage:

| Per-environment variable | Meaning |
|--------------------------|---------|
| `PROJECT_ID` | That environment's backend project |
| `FIREBASE_PROJECT_ID` | That environment's Firebase project |
| `MARKETING_SITE_ID` | Firebase Hosting site for the Astro marketing app |
| `APP_SITE_ID` | Firebase Hosting site for the React SPA |
| `ADMIN_SITE_ID` | Firebase Hosting site for the admin console (Addendum A §A2.1) |
| `EDGE_API_URL` | Public HTTPS edge Cloud Run URL for this environment |
| `FIREBASE_API_KEY` | Public Firebase web SDK API key (not an admin credential) |
| `FIREBASE_AUTH_DOMAIN` | `<FIREBASE_PROJECT_ID>.firebaseapp.com` |

The SPA build uses `hosting-dev`, `hosting-staging`, or `hosting-production`.
The workflow injects the four public settings as `VITE_*` variables. Missing,
empty, inconsistent, or emulator settings fail before bundling; local `.env`
files are never loaded in these modes. Both the build and Firebase predeploy
scan the output for local/emulator markers. Source maps are not published.

**The admin console builds the same way.** `apps/somnus-admin` has its own
`build:hosting`, its own `hosting.dev.json`, the same strict schema, and its own
`predeploy` guard on the `admin` target in firebase.json. Both SPAs must be built
with `--mode hosting-<env>`; a plain `vite build` loads local .env files, keeps
source maps, emits no `hosting-config.json`, and validates nothing, so its output
cannot pass the predeploy guard. The console was deployed that way once, pointing
at `localhost:8080` with `demo-api-key`, which is why the guard now covers it.

| Per-environment secret | Meaning |
|------------------------|---------|
| `WIF_PROVIDER` | WIF provider resource name for this env's deploy SA |
| `WIF_SERVICE_ACCOUNT` | This env's deploy SA email |

These must match the `terraform.tfvars` you fill in for each environment
(`environments/{staging,production}`), so infra and deploys target the same
projects/sites.

## 4. The approval gates (staging + production)

The gates are **GitHub Environment protection rules**, not workflow code. In each
Environment's settings:

- **staging** — add **Required reviewers** (the "approved promotion" gate). The
  `deploy staging` job pauses until a reviewer approves.
- **production** — add **Required reviewers** (the "manual approval" gate), and
  consider restricting deployments to the `main` branch. The `deploy production`
  job pauses until approved.

`dev` needs no reviewers (automatic on merge).

## 5. Infrastructure vs. application

This pipeline promotes **application deploys** (service images + frontends).
Infrastructure changes go through `terraform.yml` (fmt + validate on every PR)
and a gated `terraform apply` per environment — apply staging/production from CI
using the same WIF deploy SA and the GCS state bucket
(`environments/*/backend.hcl`). Keep infra and app project/site IDs in sync
between `terraform.tfvars` and the GitHub Environment variables above.

## 6. Rollback

A bad deploy is a traffic switch back to the last-good Cloud Run revision — see
[rollback.md](rollback.md) §1. Because images are immutable and tagged by commit
SHA, re-deploying a previous SHA is always available.

## 7. First run

After the setup above, merge a small change and watch `Deploy & Promote`: it
builds only the changed deployables, deploys to dev, then waits at the staging
and production gates for approval. Expect to iterate once on IAM scopes and the
WIF principal binding — that first real run is where the last configuration gaps
surface.
