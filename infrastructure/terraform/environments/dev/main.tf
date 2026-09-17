# The Somnus -- dev environment (build plan §20 Phase 5, Checkpoint 5.1).
#
# Two GCP projects, by explicit decision:
#   - var.project_id          ("the-somnus")  -- backend infra: Cloud Run,
#     Artifact Registry, service accounts, Cloud Storage, budget/monitoring.
#   - var.firebase_project_id ("the-somnuss") -- Firebase: Hosting sites,
#     Authentication, Firestore. Matches the project already referenced in
#     .firebaserc and package.json's deploy scripts.
# Firebase ID-token verification (build plan §10) needs no cross-project
# IAM: it validates against Google's public certs plus the Firebase
# project ID, not a same-project resource. Nothing else crosses the
# project boundary yet -- once Firestore is actually wired into a
# service (build plan §9/§10.2), that service's SA will need an
# explicit `google_project_iam_member` grant on firebase_project_id
# (roles/datastore.user), added at that checkpoint, not guessed now.
#
# What this creates: project APIs (on both projects), one Artifact
# Registry repo, one least-privilege service account per Cloud Run
# service, the five Cloud Run service shells (bootstrap placeholder
# image -- see the cloud-run-service module), invoker IAM so only
# somnus-edge-api can reach the four private services, the reports
# Cloud Storage bucket, Firebase Hosting sites for both frontends, a
# budget alert per project, and one baseline monitoring alert.
#
# What this deliberately does NOT create yet, and why: concrete Secret
# Manager secrets, Cloud Tasks queues, Pub/Sub topics, and Cloud
# Scheduler jobs. The reusable modules exist (per the checkpoint's
# module list) but nothing calls them here -- no service reads a
# secret, enqueues a task, or exposes the endpoint a scheduled job
# would call yet. Wiring concrete instances now would mean guessing at
# names/config for features that land in Phases 6, 7, 11, and 12.

locals {
  backend_apis = [
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudtasks.googleapis.com",
    "pubsub.googleapis.com",
    "cloudscheduler.googleapis.com",
    "storage.googleapis.com",
    "bigquery.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudtrace.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    # Also needed on the backend project: with user_project_override,
    # every API call (even ones targeting firebase_project_id) is
    # quota-billed against project_id, and Google checks enablement
    # against *that* project, not the resource's own project, for
    # several Firebase Management/Hosting API calls. All of
    # local.firebase_apis is duplicated here for that reason.
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firestore.googleapis.com",
  ]

  firebase_apis = [
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "identitytoolkit.googleapis.com",
    "firestore.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]

  # Baseline runtime permissions every Cloud Run service account needs
  # (write its own logs/metrics/traces). Anything beyond this is added
  # per-service, per-resource (e.g. secretmanager.secretAccessor scoped
  # to one secret) as the phase that needs it lands -- never a broad
  # project-level grant "just in case".
  baseline_roles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ]
}

module "project_apis_backend" {
  source     = "../../modules/project-apis"
  project_id = var.project_id
  apis       = local.backend_apis
}

module "project_apis_firebase" {
  source     = "../../modules/project-apis"
  project_id = var.firebase_project_id
  apis       = local.firebase_apis
}

module "artifact_registry" {
  source     = "../../modules/artifact-registry"
  project_id = var.project_id
  region     = var.region

  depends_on = [module.project_apis_backend]
}

# --- Service accounts (one per Cloud Run service, least privilege) ---

module "sa_edge_api" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "somnus-edge-api"
  display_name  = "somnus-edge-api runtime"
  description   = "Public BFF: Firebase token verification, session cookies, composition. No TiDB connection (build plan §5.3)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_identity" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "somnus-identity"
  display_name  = "somnus-identity-service runtime"
  description   = "Users, orgs, roles, authorization, and the isolated Consent module (build plan §5.4)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_morpheo" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "somnus-morpheo"
  display_name  = "morpheo-service runtime"
  description   = "Assessment definitions, deterministic scoring, safety/orientation rules (build plan §5.5)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_report" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "somnus-report"
  display_name  = "somnus-report-service runtime"
  description   = "Report rendering (HTML/PDF via WeasyPrint), controlled AI wording (build plan §5.6)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_worker" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "somnus-worker"
  display_name  = "somnus-worker runtime"
  description   = "Isolated Notification (Brevo/Cloud Tasks) and Audit modules, scheduled cleanup jobs (build plan §5.7)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

# --- Cloud Run services ---
# All five start on the public placeholder image (see cloud-run-service
# variable "image"): no image has ever been pushed to Artifact Registry
# yet (build plan Phase 13.3 is where CI/CD starts doing that), and
# Cloud Run requires an image that exists at apply time.

module "run_edge_api" {
  source                = "../../modules/cloud-run-service"
  project_id            = var.project_id
  region                = var.region
  service_name          = "somnus-edge-api"
  service_account_email = module.sa_edge_api.email
  public                = true
  env_vars = {
    LOG_LEVEL           = "info"
    LOG_FORMAT          = "json"
    NODE_ENV            = "production"
    SERVICE_NAME        = "somnus-edge-api"
    INTERNAL_AUTH_MODE  = "gcp"
    FIREBASE_PROJECT_ID = "the-somnuss"
    COOKIE_SECURE       = "true"
    COOKIE_SAMESITE     = "none"
    MORPHEO_BASE_URL    = "https://morpheo-service-lx3fvb5r5q-ey.a.run.app"
    IDENTITY_BASE_URL   = "https://somnus-identity-service-lx3fvb5r5q-ey.a.run.app"
    REPORT_BASE_URL     = "https://somnus-report-service-lx3fvb5r5q-ey.a.run.app"
    CORS_ORIGINS        = "https://the-somnus-app.web.app,https://the-somnus-app.firebaseapp.com,https://the-somnuss.web.app,https://the-somnuss.firebaseapp.com,https://app.thesomnus.com"
  }
  secret_env_vars = {
    COOKIE_SECRET = { secret_id = "edge-cookie-secret", version = "latest" }
  }
  labels = { app = "somnus", service = "edge-api", env = var.env }

  depends_on = [module.project_apis_backend]
}

module "run_identity" {
  source                = "../../modules/cloud-run-service"
  project_id            = var.project_id
  region                = var.region
  service_name          = "somnus-identity-service"
  service_account_email = module.sa_identity.email
  public                = false
  # ADR 0008 wants this service private, and it is not, deliberately and
  # temporarily. `INTERNAL_ONLY` would block somnus-edge-api, which reaches this
  # service over its run.app URL with no VPC routing: Cloud Run is not a source
  # Google counts as internal ingress, and the rejection happens before the
  # `run.invoker` binding edge-api holds is ever consulted (verified against
  # Google's ingress documentation, 2026-09-17; the live services had already
  # been flipped to ALL out of band, which is most likely why).
  #
  # So this declares what is running rather than proposing an outage. ADR 0008's
  # intent is UNMET and needs a real connectivity decision -- Direct VPC egress
  # on edge-api, or an internal Application Load Balancer -- which is an
  # architecture change, not a flag.
  #
  # IAM is unaffected: `public` stays false, so allUsers gets nothing and only
  # edge-api's service account can invoke this.
  ingress = "INGRESS_TRAFFIC_ALL"
  env_vars = {
    LOG_LEVEL      = "info"
    LOG_FORMAT     = "json"
    NODE_ENV       = "production"
    SERVICE_NAME   = "somnus-identity-service"
    DB_SSL         = "true"
    CONSENT_DB_SSL = "true"
  }
  secret_env_vars = {
    DATABASE_URL         = { secret_id = "identity-db-url", version = "latest" }
    CONSENT_DATABASE_URL = { secret_id = "consent-db-url", version = "latest" }
  }
  labels = { app = "somnus", service = "identity", env = var.env }

  depends_on = [module.project_apis_backend]
}

module "run_morpheo" {
  source                = "../../modules/cloud-run-service"
  project_id            = var.project_id
  region                = var.region
  service_name          = "morpheo-service"
  service_account_email = module.sa_morpheo.email
  public                = false
  # ADR 0008 wants this service private, and it is not, deliberately and
  # temporarily. `INTERNAL_ONLY` would block somnus-edge-api, which reaches this
  # service over its run.app URL with no VPC routing: Cloud Run is not a source
  # Google counts as internal ingress, and the rejection happens before the
  # `run.invoker` binding edge-api holds is ever consulted (verified against
  # Google's ingress documentation, 2026-09-17; the live services had already
  # been flipped to ALL out of band, which is most likely why).
  #
  # So this declares what is running rather than proposing an outage. ADR 0008's
  # intent is UNMET and needs a real connectivity decision -- Direct VPC egress
  # on edge-api, or an internal Application Load Balancer -- which is an
  # architecture change, not a flag.
  #
  # IAM is unaffected: `public` stays false, so allUsers gets nothing and only
  # edge-api's service account can invoke this.
  ingress = "INGRESS_TRAFFIC_ALL"
  env_vars = {
    ENV          = "production"
    LOG_LEVEL    = "info"
    LOG_FORMAT   = "json"
    SERVICE_NAME = "morpheo-service"
  }
  secret_env_vars = {
    DATABASE_URL = { secret_id = "morpheo-db-url", version = "latest" }
  }
  labels = { app = "somnus", service = "morpheo", env = var.env }

  depends_on = [module.project_apis_backend]
}

module "run_report" {
  source                = "../../modules/cloud-run-service"
  project_id            = var.project_id
  region                = var.region
  service_name          = "somnus-report-service"
  service_account_email = module.sa_report.email
  public                = false
  # ADR 0008 wants this service private, and it is not, deliberately and
  # temporarily. `INTERNAL_ONLY` would block somnus-edge-api, which reaches this
  # service over its run.app URL with no VPC routing: Cloud Run is not a source
  # Google counts as internal ingress, and the rejection happens before the
  # `run.invoker` binding edge-api holds is ever consulted (verified against
  # Google's ingress documentation, 2026-09-17; the live services had already
  # been flipped to ALL out of band, which is most likely why).
  #
  # So this declares what is running rather than proposing an outage. ADR 0008's
  # intent is UNMET and needs a real connectivity decision -- Direct VPC egress
  # on edge-api, or an internal Application Load Balancer -- which is an
  # architecture change, not a flag.
  #
  # IAM is unaffected: `public` stays false, so allUsers gets nothing and only
  # edge-api's service account can invoke this.
  ingress = "INGRESS_TRAFFIC_ALL"
  env_vars = {
    ENV              = "production"
    LOG_LEVEL        = "info"
    SERVICE_NAME     = "somnus-report-service"
    LOG_FORMAT       = "json"
    MORPHEO_BASE_URL = "https://morpheo-service-lx3fvb5r5q-ey.a.run.app"
  }
  # OPENAI_API_KEY is the embedding key, and nothing else.
  #
  # AI_REWRITE_ENABLED is deliberately NOT set here. It is a separate setting
  # with its own env var, defaulting to false in `report.settings.config`, and
  # the chat adapter it would need is constructed by nothing in the service.
  # Mounting this key enables embedding and cannot enable AI rewriting; that
  # remains a separate, explicit decision (build plan §15 / Addendum A 15.3).
  secret_env_vars = {
    DATABASE_URL   = { secret_id = "report-db-url", version = "latest" }
    OPENAI_API_KEY = { secret_id = "OPENAI_API_KEY", version = "latest" }
  }
  labels = { app = "somnus", service = "report", env = var.env }

  # The IAM binding must exist before a revision that mounts the secret starts:
  # Cloud Run resolves `value_source` at deploy time, and a revision whose
  # service account cannot read the secret fails to come up.
  depends_on = [
    module.project_apis_backend,
    google_secret_manager_secret_iam_member.report_openai_api_key,
  ]
}

module "run_worker" {
  source                = "../../modules/cloud-run-service"
  project_id            = var.project_id
  region                = var.region
  service_name          = "somnus-worker"
  service_account_email = module.sa_worker.email
  public                = false
  env_vars = {
    LOG_LEVEL            = "info"
    SERVICE_NAME         = "somnus-worker"
    LOG_FORMAT           = "json"
    NODE_ENV             = "production"
    NOTIFICATIONS_DB_SSL = "true"
    AUDIT_DB_SSL         = "true"
    ENV                  = "production"
  }
  secret_env_vars = {
    NOTIFICATIONS_DATABASE_URL = { secret_id = "notifications-db-url", version = "latest" }
    AUDIT_DATABASE_URL         = { secret_id = "audit-db-url", version = "latest" }
  }
  labels = { app = "somnus", service = "worker", env = var.env }

  depends_on = [module.project_apis_backend]
}

# --- Cloud Run IAM: only somnus-edge-api may invoke the private four ---

module "iam_identity" {
  source          = "../../modules/cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_identity.service_name
  invoker_members = [module.sa_edge_api.member]
}

module "iam_morpheo" {
  source          = "../../modules/cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_morpheo.service_name
  invoker_members = [module.sa_edge_api.member]
}

module "iam_report" {
  source          = "../../modules/cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_report.service_name
  invoker_members = [module.sa_edge_api.member]
}

module "iam_worker" {
  source          = "../../modules/cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_worker.service_name
  invoker_members = [module.sa_edge_api.member]
}

# --- Storage: report PDFs (build plan §5.6, §9) ---

module "reports_bucket" {
  source         = "../../modules/cloud-storage-bucket"
  project_id     = var.project_id
  region         = var.region
  bucket_name    = "${var.project_id}-reports"
  writer_members = [module.sa_report.member]

  depends_on = [module.project_apis_backend]
}

# --- Firebase Hosting (build plan §5.1, §5.2) ---
# Lives in var.firebase_project_id, not var.project_id. Site IDs match
# the targets already configured in .firebaserc.

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.firebase_project_id

  # Needs both: the API must be enabled on firebase_project_id (the
  # resource being managed) *and* on project_id (the user_project_override
  # billing/quota project every API call is attributed to -- see versions.tf).
  depends_on = [module.project_apis_firebase, module.project_apis_backend]
}

module "hosting_marketing" {
  source     = "../../modules/firebase-hosting-site"
  project_id = var.firebase_project_id
  # Reuse Firebase's required default site for the public marketing entry
  # point instead of provisioning a redundant secondary Hosting site.
  site_id = "the-somnuss"

  providers = {
    google-beta = google-beta
  }

  depends_on = [google_firebase_project.this]
}

module "hosting_app" {
  source     = "../../modules/firebase-hosting-site"
  project_id = var.firebase_project_id
  # "somnus-app" is already claimed by an unrelated Firebase project --
  # site IDs are globally unique across all of Firebase, like GCS bucket
  # names. the-somnus-app avoided the collision.
  site_id = "the-somnus-app"

  providers = {
    google-beta = google-beta
  }

  depends_on = [google_firebase_project.this]
}

# --- Secrets: managed outside Terraform (build plan: no secret values in code) ---
#
# Every secret this project uses -- the seven database/cookie secrets the services
# mount, BOOTSTRAP_SUPER_ADMIN_EMAIL, and OPENAI_API_KEY -- was created by hand in
# Secret Manager and is NOT managed here. Terraform references them by id where a
# service mounts one, and owns none of them.
#
# There used to be a `module "bootstrap_secret"` that declared
# BOOTSTRAP_SUPER_ADMIN_EMAIL as a resource. It had never been applied (no
# google_secret_manager_secret exists in state), the secret already existed, so
# applying it would have failed with 409 -- and importing it instead would have
# been worse: the secret-manager module pins `user_managed` replication to
# var.region, the live secret is AUTOMATIC, and replication is immutable, so
# Terraform would have planned to DESTROY AND RECREATE a live secret.
#
# Nothing at runtime reads BOOTSTRAP_SUPER_ADMIN_EMAIL: only the manually invoked
# `bootstrap:super-admin` script does, with the operator's own credentials.

# --- Read access to the embedding key (build plan §3.6b / Addendum B §B2a) ---
#
# Least privilege, and narrower than the project: `local.baseline_roles` grants
# no Secret Manager access to any runtime service account, and this does not
# change that. It grants ONE service account read on ONE secret -- the same shape
# the seven database/cookie secrets already have, which were granted by hand.
#
# Only the report service embeds: the Index A batch job (Checkpoint 11.3/16.0)
# and the Index B corpus indexer (Checkpoint 16.4) both read OPENAI_API_KEY
# through `report.settings.config`. No other service has any use for it, so no
# other service account is named here.
#
# The secret itself is referenced, never created -- see the secrets note above.
# This is the one binding that does not exist yet, so it is the one thing in this
# change that a plan should propose.
data "google_secret_manager_secret" "openai_api_key" {
  project   = var.project_id
  secret_id = "OPENAI_API_KEY"
}

resource "google_secret_manager_secret_iam_member" "report_openai_api_key" {
  project   = var.project_id
  secret_id = data.google_secret_manager_secret.openai_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = module.sa_report.member
}

# --- Cost guardrail (build plan §2) ---
# One budget per project: Firebase Hosting/Auth free-tier usage means
# the-somnuss should rarely approach its (smaller) budget, but §2 says
# every environment gets budget alerts, not just the one doing the
# expensive Cloud Run work.

module "budget_alert_backend" {
  source              = "../../modules/budget-alert"
  project_id          = var.project_id
  billing_account_id  = var.billing_account_id
  budget_amount_units = var.budget_amount_units
  display_name        = "The Somnus backend (${var.project_id}) - ${var.env} monthly budget"

  depends_on = [module.project_apis_backend]
}

module "budget_alert_firebase" {
  source              = "../../modules/budget-alert"
  project_id          = var.firebase_project_id
  billing_account_id  = var.billing_account_id
  budget_amount_units = var.firebase_budget_amount_units
  display_name        = "The Somnus Firebase (${var.firebase_project_id}) - ${var.env} monthly budget"

  depends_on = [module.project_apis_backend, module.project_apis_firebase]
}

# --- Baseline monitoring alert ---
# A conservative placeholder, not a tuned SLO (build plan Checkpoint
# 13.3 re-tunes thresholds from real traffic). Watches somnus-edge-api,
# the only publicly-reachable service, for a sustained 5xx rate.

module "alert_edge_api_5xx" {
  source                 = "../../modules/monitoring-alert"
  project_id             = var.project_id
  display_name           = "somnus-edge-api: sustained 5xx rate"
  condition_display_name = "5xx responses > 5/min for 5 minutes"
  filter                 = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${module.run_edge_api.service_name}"
    metric.type="run.googleapis.com/request_count"
    metric.labels.response_code_class="5xx"
  EOT
  comparison             = "COMPARISON_GT"
  threshold_value        = 5
  duration               = "300s"
  documentation          = "somnus-edge-api is returning 5xx responses at a sustained rate. This is a conservative dev-environment placeholder threshold, re-tuned from observed baselines at build plan Checkpoint 13.3."

  depends_on = [module.project_apis_backend]
}
