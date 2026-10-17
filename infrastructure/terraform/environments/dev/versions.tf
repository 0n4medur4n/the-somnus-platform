# Remote GCS backend, like staging and production. Dev state used to be a
# local file on one laptop: unversioned, unlocked, lost with the disk. The
# bucket is supplied at init via partial configuration (backend blocks cannot
# use variables):
#
#   terraform init -backend-config=backend.hcl
#
# Copy backend.hcl.example to backend.hcl (gitignored). The one-time move of
# the existing local state is docs/runbooks/terraform-state-dev.md.

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
    # bucket comes from -backend-config (see backend.hcl.example).
    prefix = "terraform/state/dev"
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
