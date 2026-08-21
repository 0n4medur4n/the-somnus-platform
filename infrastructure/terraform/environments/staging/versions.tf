# Staging environment (build plan §20 Checkpoint 13.3).
#
# Remote GCS backend (unlike dev's local backend): staging and production state
# is applied from CI (the promotion pipeline) and must be shared and locked. The
# bucket is NOT hard-coded here -- backend blocks cannot use variables -- it is
# supplied at init via partial configuration:
#
#   terraform init -backend-config=backend.hcl
#
# Copy backend.hcl.example to backend.hcl (gitignored) and fill in the bucket.
# The bucket must already exist (create it once, out of band, with versioning +
# uniform access) before the first init.

terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
  }

  backend "gcs" {
    # bucket + prefix come from -backend-config (see backend.hcl.example).
    prefix = "terraform/state/staging"
  }
}

# user_project_override + billing_project: see the dev environment's versions.tf
# for the full rationale. Under a CI service account the same header is required
# for the billingbudgets / Firebase Management calls to attribute quota to
# project_id rather than the caller's own project.
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
