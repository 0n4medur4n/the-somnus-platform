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
    SERVICE_NAME = "somnus-edge-api"
    NODE_ENV     = "production"
    LOG_LEVEL    = "info"
    LOG_FORMAT   = "json"
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
  env_vars = {
    SERVICE_NAME = "somnus-identity-service"
    NODE_ENV     = "production"
    LOG_LEVEL    = "info"
    LOG_FORMAT   = "json"
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
  env_vars = {
    SERVICE_NAME = "morpheo-service"
    ENV          = "production"
    LOG_LEVEL    = "info"
    LOG_FORMAT   = "json"
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
  env_vars = {
    SERVICE_NAME = "somnus-report-service"
    ENV          = "production"
    LOG_LEVEL    = "info"
    LOG_FORMAT   = "json"
  }
  labels = { app = "somnus", service = "report", env = var.env }

  depends_on = [module.project_apis_backend]
}

module "run_worker" {
  source                = "../../modules/cloud-run-service"
  project_id            = var.project_id
  region                = var.region
  service_name          = "somnus-worker"
  service_account_email = module.sa_worker.email
  public                = false
  env_vars = {
    SERVICE_NAME = "somnus-worker"
    NODE_ENV     = "production"
    LOG_LEVEL    = "info"
    LOG_FORMAT   = "json"
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
