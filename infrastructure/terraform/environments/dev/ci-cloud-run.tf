# Identities for the Cloud Run promotion pipeline (ADR 0030).
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

# roles/run.developer on each service, not on the project. It can publish a
# revision of these five services only. It can still point that revision at
# any image the account can read (the somnus repository, or a public image).
# Nothing here limits the tag to one produced by deploy.yml.
resource "google_cloud_run_v2_service_iam_member" "ci_run_deployer" {
  for_each = toset([
    "somnus-edge-api",
    "somnus-identity-service",
    "morpheo-service",
    "somnus-report-service",
    "somnus-worker",
  ])

  project  = var.project_id
  location = var.region
  name     = each.value
  role     = "roles/run.developer"
  member   = module.sa_ci_run_deployer.member
}

# gcloud run deploy refuses to publish a revision unless the caller can act
# as that revision's runtime service account. This role is actAs, not token
# creation: it does not include iam.serviceAccounts.getAccessToken. Bound to
# the five runtimes only.
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

# The pool provider (firebase-consolidation.tf) already rejects any token whose
# repository id or owner id is not this repository. These bindings add the
# branch: only refs/heads/main can impersonate either account. A pull request,
# a tag, or any other branch of this repo can still exchange an OIDC token,
# and that token cannot assume these accounts. The hosting deployer is a
# separate binding and is not narrowed here.
locals {
  ci_main_principal = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.ref/refs/heads/main"
}

resource "google_service_account_iam_member" "ci_image_builder_wif" {
  service_account_id = module.sa_ci_image_builder.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.ci_main_principal
}

resource "google_service_account_iam_member" "ci_run_deployer_wif" {
  service_account_id = module.sa_ci_run_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.ci_main_principal
}

output "ci_cloud_run_auth" {
  description = "Identifiers for GitHub Actions. Not secrets. Set these by hand after apply; do not put them in Terraform state consumers that print values."
  value = {
    workload_identity_provider = google_iam_workload_identity_pool_provider.github.name
    build_service_account      = module.sa_ci_image_builder.email
    deploy_service_account     = module.sa_ci_run_deployer.email
  }
}
