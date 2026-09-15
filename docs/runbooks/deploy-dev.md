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

The SPA is built explicitly with `build:hosting --mode hosting-dev`. Public dev
configuration is versioned in `apps/somnus-app/hosting.dev.json`; ignored
`.env.production` files are not a CI configuration source. Verified values:

- Edge: `https://somnus-edge-api-lx3fvb5r5q-ey.a.run.app` (`the-somnus`, `europe-west3`).
- Firebase: project `the-somnuss`, auth domain `the-somnuss.firebaseapp.com`.
- Public web app: `1:131552832912:web:f90ead739b307593ad5715`.

Reconfirm with `gcloud run services describe somnus-edge-api --project the-somnus
--region europe-west3 --format='value(status.url)'` and `firebase apps:sdkconfig
WEB 1:131552832912:web:f90ead739b307593ad5715 --project the-somnuss` before changing
the file. Firebase web API keys are public client configuration, never admin
credentials. No service-account key belongs in this file or any `VITE_*` setting.

The build and app predeploy hook both run `scripts/check-hosting-bundle.mjs`.
For an urgent app-only redeploy, run the three commands in the SPA README.
Verify `/v1/me` targets the real edge (401 is expected before login), its
preflight permits the exact app origin, and `accounts:sendOobCode` returns 200
with the real Firebase web key. Use an operator-approved recipient for the email.

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

---

## Database migrations before a service deploy

Terraform does not run migrations. Each Node service ships its own SQL
migrations and they are applied separately, **before** the service image that
depends on them is rolled out.

**Outstanding for production (see `production-readiness.md` gaps #7-#8):**

- **`0002_registration_role_branch.sql` (identity) is applied in dev, NOT in
  production.** It adds `registration_role`, `guardianship_confirmed` and
  `minor_age_band` to `individual_profiles`. The Checkpoint 14.1 registration
  flow writes all three on every provision, so deploying identity to production
  before applying it breaks registration outright — `POST
  /internal/v1/users/provision` fails on the unknown columns. Apply it first;
  `0002_registration_role_branch.down.sql` reverses it.
- **`0003_source_cited_by_rules.py` (report service) and morpheo must
  go out together, morpheo first.** Checkpoint 11.3 Stage 4 makes the report cite
  the source the fired rule actually named, and the mapping arrives in the
  `citedByRules` field of morpheo's `/internal/v1/clinical-sources` response. The
  report's sources client reads that field **strictly**: pointed at a morpheo that
  predates it, `SourceIndexer` raises `KeyError` rather than indexing a corpus
  with no mapping. That is deliberate — a silent empty mapping would put every
  report back on similarity-only citations, which is the defect Stage 4 closed,
  and nobody would see it. Order: deploy morpheo, apply the migration, deploy the
  report service, then re-run the indexer (see *Indexing the clinical-source
  corpus* below; `0004_source_text_hash.py` has to be applied first). The existing corpus keeps working
  throughout: rows written before the column read back as "cited by no rule",
  which is exactly the previous behaviour.
- **Invitation emails do not send yet.** The Checkpoint 14.2 accept flow is
  complete and works from a link, but no producer enqueues the notification
  task: the async layer (Pub/Sub topic + Cloud Tasks queue + the Brevo key in
  Secret Manager) is not wired in any environment. Until then the invitation
  token is read from the organization's invitations screen and handed to the
  invitee directly. Do not describe invitations as self-service to an operator
  before that gap closes.

---

## Indexing the clinical-source corpus (Index A)

The fifteen clinical sources (SRC-01…SRC-15) that professional reports cite are
embedded into `clinical_sources` in `somnus_reporting` (Addendum B §B2a.1,
Checkpoint 16.0). This is how that happens, and the only way it does.

**It is never run automatically.** Not on service boot, not from a migration, not
from a deploy job, not from CI. Minimum instances are zero everywhere, so the
report service boots on every cold start; indexing there would call the OpenAI API
constantly and make the index depend on which instance started first. The service
image starts `report.main`, which does not even load the indexer module —
`tests/unit/test_index_sources_job.py` checks that by importing the app in a clean
interpreter. It is an operator step, by hand, **after a `content_version` bump** in
`morpheo_workflows_v1.json`.

### What it does, and refuses to do

- Fetches the corpus from morpheo's `/internal/v1/clinical-sources` and embeds only
  each source's approved `citation` and `use` — never an assessment, never PII.
- **Idempotent**, keyed on `(content_version, src_id, text_hash)`. Re-running for a
  version that is already indexed makes **zero** embedding calls and writes
  nothing; running it twice is a no-op, not a second bill.
- **A bump costs only what changed.** A source whose `citation` and `use` hash the
  same as in any earlier version reuses that stored vector. Changing one source's
  text embeds that one source; re-wiring which rules cite a source embeds nothing.
- **Never overwrites.** Each version's rows are written once and earlier versions
  are never touched, so a report grounded under an older `content_version` still
  resolves exactly what grounded it. The store itself refuses to replace a stored
  vector, independently of the indexer.
- **All or nothing.** One transaction. A provider error, a wrong vector count
  (the Checkpoint 11.3 Stage 3 abort, unchanged) or a failed insert leaves the
  store exactly as it was — no partial version.
- **Refuses a version whose text changed without a bump.** If `1.3` is indexed and
  a source's text under `1.3` is now different, the artifact was edited without
  bumping `content_version`. It exits non-zero before any call: bump the version.
  The same refusal applies to a source dropped from an indexed version and to a
  change of `EMBEDDING_MODEL` under the same version.
- Prints one JSON line of counts on success (`embedded`, `reused`, `unchanged`,
  `indexed`). Never prints the key, the database URL, or source text.

### Prerequisites

1. **Migrations `0003_source_cited_by_rules` and `0004_source_text_hash` applied**
   to `somnus_reporting` (`uv run alembic upgrade head` from
   `services/somnus-report-service`, against the target database).
2. **A reachable morpheo serving the same artifact that is deployed.** The sources
   client sends no identity token — the same as the running report service — so a
   private Cloud Run morpheo is not reachable from a workstation. The corpus comes
   from `morpheo_workflows_v1.json`, not from morpheo's database, so a local
   morpheo **checked out at the deployed commit** serves the identical corpus:
   ```bash
   cd services/morpheo-service
   uv run uvicorn morpheo.main:app --host 127.0.0.1 --port 8082
   ```
3. **An OpenAI key — only if something needs embedding.** Not provisioned in
   Terraform or Secret Manager today; the operator supplies it for the run. Without
   one, a re-run of an already-indexed version still succeeds, and a run that needs
   vectors fails before writing anything.

### Run it

```bash
cd services/somnus-report-service
DATABASE_URL='<somnus_reporting connection string>' \
MORPHEO_BASE_URL=http://127.0.0.1:8082 \
OPENAI_API_KEY='<key, only when embedding is needed>' \
uv run python -m report.jobs.index_sources
```

Exit status `0` with a JSON line means the version is fully indexed. Anything else
means nothing was written; the one-line reason is on stderr.

### Confirm it

Run it **a second time** with the same environment. The line must report
`"embedded": 0, "reused": 0` and `"unchanged"` equal to `"indexed"`. That is the
idempotency guarantee checked against the real database, and it costs nothing.

---

## Bootstrapping the first `platform_super_admin`

Addendum A §A2.2 makes `platform_super_admin` the only role that can assign
internal roles, so a fresh environment has no way to create the first one. This
one-time script is that way in, and nothing else is.

**It is never run automatically.** Not on service boot, not from a migration,
not from a deploy job, not from CI. Wiring it into any of those would turn a
door that closes into a standing backdoor. It is an operator action, by hand,
once per environment.

### What it does, and refuses to do

- Reads the address from **Secret Manager at runtime**, by secret name
  (`BOOTSTRAP_SUPER_ADMIN_EMAIL`). The value is never an argument, never an
  environment default, never in the repository, and is never printed — not on
  success, not in an error. The only identifier it echoes is the opaque Somnus
  user id.
- **Finds** an existing account. It never creates one: the person must have
  registered through the normal magic-link flow first, so the account is one
  they actually control. If no account matches, it exits non-zero and says so
  without naming the address.
- Assigns through `InternalRolesService` — the same method the admin console
  uses. There is no parallel insert.
- Is refused once **any** `platform_super_admin` exists. Running it a second
  time is a conflict, by design.
- Records `admin.internal_role.assigned.v1` with `source="bootstrap"`, so the
  grant is visibly different from an in-console assignment when the audit log is
  read later. `role_assignments.assigned_by` is `NULL` for it, because there was
  no acting admin — never the grantee's own id, which would be indistinguishable
  from a self-assignment.

### Prerequisites

1. The secret exists and holds a value. Terraform creates the **empty
   container** (`module.bootstrap_secret`); the value is set out of band:
   ```bash
   printf '%s' 'person@example.org' | gcloud secrets versions add BOOTSTRAP_SUPER_ADMIN_EMAIL \
     --project the-somnus --data-file=-
   ```
   If the secret was created by hand before Terraform, import it rather than
   letting `apply` collide:
   ```bash
   terraform import 'module.bootstrap_secret.google_secret_manager_secret.this["BOOTSTRAP_SUPER_ADMIN_EMAIL"]' \
     projects/the-somnus/secrets/BOOTSTRAP_SUPER_ADMIN_EMAIL
   ```
2. **That person has already registered** at the dev app and can sign in.
3. Application Default Credentials for an account holding
   `roles/secretmanager.secretAccessor` on the secret:
   ```bash
   gcloud auth login --update-adc
   ```
   No service account is granted access to this secret. Nothing at runtime reads
   it; only this script does, with the operator's own credentials.

### Run it

```bash
GCP_PROJECT_ID=the-somnus \
DATABASE_URL='<identity dev connection string>' \
DB_SSL=true \
pnpm --filter @somnus/identity-service bootstrap:super-admin
```

### Confirm it

Not by trusting the output — by asking the authorization service, which is what
the console itself asks:

```bash
curl -s -X POST "$IDENTITY_URL/internal/v1/authorization/admin-context" \
  -H 'content-type: application/json' \
  -d '{"actorUserId":"<the userId the script printed>"}'
```

`roleKeys` must contain `platform_super_admin`, and `capabilities` must list all
twelve of the §A2.2 capabilities.

### Warning: dev's identity database is wiped by the test suite

`services/somnus-identity-service/test/global-setup.ts` drops **every table** in
`somnus_identity` before a test run, and CI runs the identity suite on every
push. A bootstrap grant made against dev therefore survives only until the next
test run, and the account itself is deleted with it.

That is fine for proving the flow, and it means **dev is not a place to keep a
standing admin**. In staging and production the identity database is not shared
with CI, and the grant persists. Re-run the script after a dev wipe; it is
refused only while a super admin actually exists.
