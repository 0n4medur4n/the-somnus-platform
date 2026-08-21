# The Somnus -- shared environment composition (build plan §20 Checkpoint 13.3).
#
# One module, three environments (dev inline today; staging + production call
# this module). Everything an environment provisions lives here so the
# environments cannot drift: project APIs on both projects, one Artifact Registry
# repo, one least-privilege service account per Cloud Run service, the five Cloud
# Run service shells (bootstrap placeholder image; CI/CD pushes real images per
# the promotion pipeline), invoker IAM so only somnus-edge-api can reach the four
# private services, the reports bucket, both Firebase Hosting sites, a budget
# alert per project, and a baseline monitoring alert.
#
# Two GCP projects per environment, by explicit decision (build plan §5.1):
#   - var.project_id          -- backend infra.
#   - var.firebase_project_id -- Firebase Hosting/Auth/Firestore.
#
# Deliberately NOT created yet (a gap tracked in the Checkpoint 13.3 DoD sweep,
# not silently invented per-environment): concrete Secret Manager secrets, Cloud
# Tasks queues, Pub/Sub topics, and Cloud Scheduler jobs. The reusable modules
# exist, but wiring concrete instances requires the exact names/config each
# service expects; dev does not have them either, so this is an all-environments
# readiness item, reported as a numbered gap rather than guessed here.

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
    # With user_project_override, API calls targeting firebase_project_id are
    # still quota-billed against project_id and Google checks enablement against
    # that project for several Firebase Management/Hosting calls -- so the
    # Firebase APIs are duplicated onto the backend project too.
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

  # Baseline runtime permissions every Cloud Run service account needs (write its
  # own logs/metrics/traces). Anything beyond this is added per-service,
  # per-resource as the phase that needs it lands -- never a broad project grant.
  baseline_roles = [
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudtrace.agent",
  ]
}

module "project_apis_backend" {
  source     = "../project-apis"
  project_id = var.project_id
  apis       = local.backend_apis
}

module "project_apis_firebase" {
  source     = "../project-apis"
  project_id = var.firebase_project_id
  apis       = local.firebase_apis
}

module "artifact_registry" {
  source     = "../artifact-registry"
  project_id = var.project_id
  region     = var.region

  depends_on = [module.project_apis_backend]
}

# --- Service accounts (one per Cloud Run service, least privilege) ---

module "sa_edge_api" {
  source        = "../service-account"
  project_id    = var.project_id
  account_id    = "somnus-edge-api"
  display_name  = "somnus-edge-api runtime"
  description   = "Public BFF: Firebase token verification, session cookies, composition. No TiDB connection (build plan §5.3)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_identity" {
  source        = "../service-account"
  project_id    = var.project_id
  account_id    = "somnus-identity"
  display_name  = "somnus-identity-service runtime"
  description   = "Users, orgs, roles, authorization, and the isolated Consent module (build plan §5.4)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_morpheo" {
  source        = "../service-account"
  project_id    = var.project_id
  account_id    = "somnus-morpheo"
  display_name  = "morpheo-service runtime"
  description   = "Assessment definitions, deterministic scoring, safety/orientation rules (build plan §5.5)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_report" {
  source        = "../service-account"
  project_id    = var.project_id
  account_id    = "somnus-report"
  display_name  = "somnus-report-service runtime"
  description   = "Report rendering (HTML/PDF via WeasyPrint), controlled AI wording (build plan §5.6)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

module "sa_worker" {
  source        = "../service-account"
  project_id    = var.project_id
  account_id    = "somnus-worker"
  display_name  = "somnus-worker runtime"
  description   = "Isolated Notification (Brevo/Cloud Tasks) and Audit modules, scheduled cleanup jobs (build plan §5.7)."
  project_roles = local.baseline_roles

  depends_on = [module.project_apis_backend]
}

# --- Cloud Run services ---
# All five start on the public placeholder image (see cloud-run-service variable
# "image"): the promotion pipeline (build plan Checkpoint 13.3) pushes real
# images per service, and Cloud Run requires an image that exists at apply time.
# Min instances is 0 everywhere -- enforced by the module's validation block.

module "run_edge_api" {
  source                = "../cloud-run-service"
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
  source                = "../cloud-run-service"
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
  source                = "../cloud-run-service"
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
  source                = "../cloud-run-service"
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
  source                = "../cloud-run-service"
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
  source          = "../cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_identity.service_name
  invoker_members = [module.sa_edge_api.member]
}

module "iam_morpheo" {
  source          = "../cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_morpheo.service_name
  invoker_members = [module.sa_edge_api.member]
}

module "iam_report" {
  source          = "../cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_report.service_name
  invoker_members = [module.sa_edge_api.member]
}

module "iam_worker" {
  source          = "../cloud-run-iam"
  project_id      = var.project_id
  region          = var.region
  service_name    = module.run_worker.service_name
  invoker_members = [module.sa_edge_api.member]
}

# --- Storage: report PDFs (build plan §5.6, §9) ---

module "reports_bucket" {
  source         = "../cloud-storage-bucket"
  project_id     = var.project_id
  region         = var.region
  bucket_name    = "${var.project_id}-reports"
  writer_members = [module.sa_report.member]

  depends_on = [module.project_apis_backend]
}

# --- Firebase Hosting (build plan §5.1, §5.2) ---
# Lives in var.firebase_project_id, not var.project_id. Site IDs are supplied by
# the calling environment: they are globally unique across all of Firebase (like
# GCS bucket names), so each environment must use its own.

resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.firebase_project_id

  # Needs both: the API enabled on firebase_project_id (the managed resource) and
  # on project_id (the user_project_override billing/quota project).
  depends_on = [module.project_apis_firebase, module.project_apis_backend]
}

module "hosting_marketing" {
  source     = "../firebase-hosting-site"
  project_id = var.firebase_project_id
  site_id    = var.marketing_site_id

  providers = {
    google-beta = google-beta
  }

  depends_on = [google_firebase_project.this]
}

module "hosting_app" {
  source     = "../firebase-hosting-site"
  project_id = var.firebase_project_id
  site_id    = var.app_site_id

  providers = {
    google-beta = google-beta
  }

  depends_on = [google_firebase_project.this]
}

# --- Cost guardrail (build plan §2): one budget per project ---

module "budget_alert_backend" {
  source              = "../budget-alert"
  project_id          = var.project_id
  billing_account_id  = var.billing_account_id
  budget_amount_units = var.budget_amount_units
  display_name        = "The Somnus backend (${var.project_id}) - ${var.env} monthly budget"

  depends_on = [module.project_apis_backend]
}

module "budget_alert_firebase" {
  source              = "../budget-alert"
  project_id          = var.firebase_project_id
  billing_account_id  = var.billing_account_id
  budget_amount_units = var.firebase_budget_amount_units
  display_name        = "The Somnus Firebase (${var.firebase_project_id}) - ${var.env} monthly budget"

  depends_on = [module.project_apis_backend, module.project_apis_firebase]
}

# --- Baseline monitoring alert ---
# Watches somnus-edge-api (the only publicly-reachable service) for a sustained
# 5xx rate. Threshold/duration are variables so each environment can be re-tuned
# from observed baselines after the Checkpoint 13.3 load test.

module "alert_edge_api_5xx" {
  source                 = "../monitoring-alert"
  project_id             = var.project_id
  display_name           = "somnus-edge-api: sustained 5xx rate (${var.env})"
  condition_display_name = "5xx responses > ${var.edge_5xx_threshold}/min for ${var.edge_5xx_duration}"
  filter                 = <<-EOT
    resource.type="cloud_run_revision"
    resource.labels.service_name="${module.run_edge_api.service_name}"
    metric.type="run.googleapis.com/request_count"
    metric.labels.response_code_class="5xx"
  EOT
  comparison             = "COMPARISON_GT"
  threshold_value        = var.edge_5xx_threshold
  duration               = var.edge_5xx_duration
  documentation          = "somnus-edge-api is returning 5xx responses at a sustained rate in ${var.env}. Threshold re-tuned from observed baselines at build plan Checkpoint 13.3."

  depends_on = [module.project_apis_backend]
}
