# Local backend: state is a local file (gitignored: infrastructure/
# terraform/**/*.tfstate*), appropriate for a single-operator dev
# environment. Before staging/production (build plan §20 Checkpoint
# 13.3) go live, migrate to a GCS remote backend so state is shared and
# locked -- `terraform init -migrate-state` once that bucket exists.

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

  backend "local" {
    path = "terraform.tfstate"
  }
}

# project here is only the *default* for resources that don't set their
# own `project` argument. Every resource in this environment sets one
# explicitly, so Firebase resources correctly land in
# var.firebase_project_id even though it differs from this default.
#
# user_project_override + billing_project: when authenticating with a
# user's Application Default Credentials (gcloud auth login
# --update-adc, as opposed to a service account key), some APIs
# (billingbudgets.googleapis.com among them) reject requests unless the
# provider explicitly sends an X-Goog-User-Project header naming which
# project to bill/quota the call against. Without this, Google silently
# attributes the call to gcloud's own internal OAuth client project,
# which has none of our APIs enabled -> SERVICE_DISABLED errors that
# have nothing to do with the actual target resource's project.
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
