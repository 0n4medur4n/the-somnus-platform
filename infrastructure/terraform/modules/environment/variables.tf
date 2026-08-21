variable "project_id" {
  description = "GCP project ID for backend infra: Cloud Run, Artifact Registry, service accounts, Secret Manager, Cloud Tasks, Pub/Sub, Cloud Scheduler, Cloud Storage."
  type        = string
}

variable "firebase_project_id" {
  description = "GCP project ID hosting Firebase: Hosting sites, Authentication, Firestore. Deliberately separate from project_id (build plan §5.1, matches .firebaserc)."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID linked to both projects (format XXXXXX-XXXXXX-XXXXXX). Required for the budget-alert modules."
  type        = string
}

variable "region" {
  description = "Build plan §3.8: europe-west3 for every environment."
  type        = string
  default     = "europe-west3"
}

variable "env" {
  description = "Environment name (dev | staging | production). Used in labels, budget display names, and the reports bucket suffix is per project."
  type        = string

  validation {
    condition     = contains(["dev", "staging", "production"], var.env)
    error_message = "env must be one of: dev, staging, production."
  }
}

variable "budget_amount_units" {
  description = "Monthly budget in whole currency units for project_id (backend)."
  type        = number
}

variable "firebase_budget_amount_units" {
  description = "Monthly budget in whole currency units for firebase_project_id. Smaller: Hosting/Auth stay mostly within the free tier."
  type        = number
}

variable "marketing_site_id" {
  description = "Firebase Hosting site ID for the Astro marketing frontend. Globally unique across all of Firebase (like a GCS bucket name), so each environment needs its own."
  type        = string
}

variable "app_site_id" {
  description = "Firebase Hosting site ID for the Vite+React SPA. Globally unique across all of Firebase, so each environment needs its own."
  type        = string
}

variable "edge_5xx_threshold" {
  description = "somnus-edge-api sustained-5xx alert threshold (responses/min). Build plan Checkpoint 13.3: re-tuned per environment from observed baselines after the load test; a conservative placeholder until then."
  type        = number
  default     = 5
}

variable "edge_5xx_duration" {
  description = "How long the 5xx rate must stay above the threshold before alerting."
  type        = string
  default     = "300s"
}
