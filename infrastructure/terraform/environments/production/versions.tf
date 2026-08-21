# Production environment (build plan §20 Checkpoint 13.3).
#
# Remote GCS backend: production state is applied from CI (the promotion pipeline,
# behind a manual approval) and must be shared and locked. The bucket is supplied
# at init via partial configuration:
#
#   terraform init -backend-config=backend.hcl
#
# Copy backend.hcl.example to backend.hcl (gitignored) and fill in the bucket.
# The bucket must already exist (versioning + uniform access) before first init.

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
    prefix = "terraform/state/production"
  }
}

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
