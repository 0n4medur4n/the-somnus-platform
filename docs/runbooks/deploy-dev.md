# Runbook: dev environment (Terraform)

Implements build plan §20 Phase 5, Checkpoint 5.1. Applies
`infrastructure/terraform/environments/dev` against **two** GCP
projects, by explicit decision:

- **`the-somnus`** (`project_id`) -- backend infra: Cloud Run,
  Artifact Registry, service accounts, Secret Manager, Cloud Tasks,
  Pub/Sub, Cloud Scheduler, Cloud Storage.
- **`the-somnuss`** (`firebase_project_id`) -- Firebase: Hosting sites,
  Authentication, Firestore. Matches the project already referenced in
  `.firebaserc` and `package.json`'s deploy scripts.

Firebase ID-token verification (build plan §10) does not need any
cross-project IAM grant: it validates against Google's public certs
plus the Firebase project ID, nothing same-project-only. If a later
checkpoint wires up Firestore from a backend service, that service's
service account will need an explicit `roles/datastore.user` grant on
`the-somnuss` at that point -- not guessed here.

## Prerequisites

- `gcloud`, authenticated as an account with **Owner** or (**Editor** +
  **Project IAM Admin** + **Billing Account User**) on both projects.
- `terraform` 1.15.x (matches `docs/environment-baseline.md`; CI pins
  the same version in `.github/workflows/terraform.yml`).
- A GCP **billing account** both projects are (or will be) linked to.

## 1. Authenticate

```bash
gcloud auth login --update-adc
gcloud config set account <the-somnus-google-account>
```

`--update-adc` also writes Application Default Credentials, which is
what the Terraform `google`/`google-beta` providers read -- `gcloud
auth login` alone is not enough for Terraform.

## 2. Confirm the projects

```bash
gcloud projects describe the-somnus
gcloud projects describe the-somnuss
gcloud billing accounts list
```

Both projects must be linked to a billing account before `terraform
apply` (the budget-alert modules and several APIs require it):

```bash
gcloud billing projects link the-somnus --billing-account=<billing-account-id>
gcloud billing projects link the-somnuss --billing-account=<billing-account-id>
```

## 3. Configure variables

```bash
cd infrastructure/terraform/environments/dev
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: project_id, firebase_project_id, billing_account_id
```

`terraform.tfvars` is gitignored -- it is never committed.

## 4. fmt, init, validate, plan

```bash
terraform fmt -recursive ../../
terraform init
terraform validate
terraform plan -out=tfplan
```

Review the plan. Expect, split across the two projects: ~16 APIs on
`the-somnus` + ~7 on `the-somnuss`, 1 Artifact Registry repo, 5
service accounts, 5 Cloud Run services (on the public placeholder
image -- see below), 4 Cloud Run invoker bindings, 1 Cloud Storage
bucket, 1 Firebase project link, 2 Firebase Hosting sites, 2 budgets
(one per project), 1 monitoring alert.

## 5. Apply

```bash
terraform apply tfplan
```

This creates real, billable (if used) GCP resources across both
projects. Re-run `terraform plan` with no `tfplan` file if time has
passed and you want a fresh diff before applying.

## About the placeholder image

Every Cloud Run service is created pointing at Google's public
`us-docker.pkg.dev/cloudrun/container/hello:latest` image, **not** a
real Somnus image -- no CI/CD pipeline has pushed one yet (that lands
in build plan Checkpoint 13.3). The `cloud-run-service` module's
`lifecycle.ignore_changes` on the image field means Terraform will not
revert a real deploy back to the placeholder once one happens; deploy
real images with:

```bash
gcloud run deploy somnus-edge-api \
  --image europe-west3-docker.pkg.dev/the-somnus/somnus/somnus-edge-api:<tag> \
  --region europe-west3 --project the-somnus
```

## What is intentionally not created yet

Secret Manager secrets, Cloud Tasks queues, Pub/Sub topics, and Cloud
Scheduler jobs. The reusable Terraform modules exist; nothing in
`environments/dev/main.tf` calls them, because no application code
reads a secret, enqueues a task, or exposes an endpoint those would
target yet. They get wired in as build plan Phases 6, 7, 11, and 12
land -- see the comment block at the top of `main.tf`.

## Destroying the environment

```bash
terraform destroy
```

`disable_on_destroy = false` on enabled APIs (see the `project-apis`
module) -- destroying the environment does not disable project APIs
on either project, since other tooling in the project may depend on
them.

## Troubleshooting

- **`Error 403: ... does not have permission`**: your active `gcloud`
  account lacks a role above, on one of the two projects. Re-check
  step 1.
- **`billing_account_id` errors on a budget resource**: confirm the
  relevant project is actually linked (`gcloud billing projects
  describe <project-id>`) before applying.
- **Firebase Hosting site already exists**: if it was created via the
  Firebase CLI/console before Terraform managed it, import it instead
  of re-creating: `terraform import module.hosting_marketing.google_firebase_hosting_site.this projects/the-somnuss/sites/the-somnuss`.

---

## CI Hosting deploy (build plan §20 Checkpoint 9.2)

CI deploys **both** frontends to dev Firebase Hosting (`the-somnuss`)
via the `deploy-hosting` job in `.github/workflows/ci.yml`:

- **Pull requests** deploy to a per-PR **preview channel**
  (`hosting:channel:deploy pr-<n>`, 7-day expiry) for both the `app` and
  `marketing` targets.
- **Pushes to `main`** deploy **live** to dev
  (`firebase deploy --only hosting`).

The job is **gated on a secret** so the pipeline stays green until it is
configured; when the secret is absent it emits a `::notice::` and does
nothing.

### One-time setup

1. Create (or reuse) a service account on the `the-somnuss` Firebase
   project with the **Firebase Hosting Admin**
   (`roles/firebasehosting.admin`) role, plus **Firebase Viewer**.
2. Generate a JSON key for it.
3. Add it as the GitHub Actions repository secret
   **`FIREBASE_SERVICE_ACCOUNT`** (the raw JSON).

The two Hosting sites must exist on the project — `the-somnuss`
(marketing) and `the-somnus-app` (app) — matching the targets in
`.firebaserc`. Create them once with
`firebase hosting:sites:create <site-id> --project the-somnuss` (or via
Terraform, above) if they do not yet exist.
