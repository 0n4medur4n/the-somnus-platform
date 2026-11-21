# Identities for the Cloud Run promotion pipeline (ADR 0023).
#
# Terraform still ignores the container image. These accounts only let GitHub
# Actions push an image and publish a Cloud Run revision. They are not Editor
# or Owner, and they cannot change IAM on the project.
#
# The Workload Identity pool already exists (firebase-consolidation.tf). These
# bindings reuse it. GitHub variables and secrets stay outside Terraform: the
# owner sets them after this plan is applied.

module "sa_ci_image_builder" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "ci-image-builder"
  display_name  = "CI: pushes Cloud Run images"
  description   = "GitHub Actions via Workload Identity Federation. Writes only the somnus Artifact Registry repository. No key."
  project_roles = []

  depends_on = [module.project_apis_backend]
}

module "sa_ci_run_deployer" {
  source        = "../../modules/service-account"
  project_id    = var.project_id
  account_id    = "ci-run-deployer"
  display_name  = "CI: deploys Cloud Run revisions"
  description   = "GitHub Actions via Workload Identity Federation. Deploys revisions and reads the somnus registry. No key."
  project_roles = []

  depends_on = [module.project_apis_backend]
}

resource "google_artifact_registry_repository_iam_member" "ci_image_builder" {
  project    = var.project_id
  location   = var.region
  repository = module.artifact_registry.repository_id
  role       = "roles/artifactregistry.writer"
  member     = module.sa_ci_image_builder.member
}

resource "google_artifact_registry_repository_iam_member" "ci_run_deployer" {
  project    = var.project_id
  location   = var.region
  repository = module.artifact_registry.repository_id
  role       = "roles/artifactregistry.reader"
  member     = module.sa_ci_run_deployer.member
}

# Deploy revisions of the existing services. run.developer cannot set IAM.
# It is project-scoped because Cloud Run has no per-service deploy role.
resource "google_project_iam_member" "ci_run_deployer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = module.sa_ci_run_deployer.member
}

# gcloud run deploy refuses to publish a revision unless the caller can act
# as that revision's runtime service account. Bound to the five runtimes only.
resource "google_service_account_iam_member" "ci_run_deployer_actas" {
  for_each = {
    edge     = module.sa_edge_api.name
    identity = module.sa_identity.name
    morpheo  = module.sa_morpheo.name
    report   = module.sa_report.name
    worker   = module.sa_worker.name
  }

  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = module.sa_ci_run_deployer.member
}

resource "google_service_account_iam_member" "ci_image_builder_wif" {
  service_account_id = module.sa_ci_image_builder.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

resource "google_service_account_iam_member" "ci_run_deployer_wif" {
  service_account_id = module.sa_ci_run_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

output "ci_cloud_run_auth" {
  description = "Identifiers for GitHub Actions. Not secrets. Set these by hand after apply; do not put them in Terraform state consumers that print values."
  value = {
    workload_identity_provider = google_iam_workload_identity_pool_provider.github.name
    build_service_account      = module.sa_ci_image_builder.email
    deploy_service_account     = module.sa_ci_run_deployer.email
  }
}
