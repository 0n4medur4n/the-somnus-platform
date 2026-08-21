# Shared environment composition (build plan §20 Checkpoint 13.3). Declares the
# providers it uses; the concrete provider configuration (region,
# user_project_override, billing_project) and the state backend live in each
# calling environment root (environments/{staging,production}), not here -- a
# module must not pin a backend, and each environment bills quota to its own
# project.

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
}
