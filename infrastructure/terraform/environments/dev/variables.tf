variable "project_id" {
  description = "GCP project ID for backend infra: Cloud Run, Artifact Registry, service accounts, Secret Manager, Cloud Tasks, Pub/Sub, Cloud Scheduler, Cloud Storage."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID linked to project_id (format XXXXXX-XXXXXX-XXXXXX). Required for the budget-alert modules."
  type        = string
}

variable "region" {
  description = "Build plan §3.8: europe-west3 for every environment."
  type        = string
  default     = "europe-west3"
}

variable "env" {
  type    = string
  default = "dev"
}

variable "budget_amount_units" {
  description = "Monthly budget in whole currency units for project_id (backend)."
  type        = number
  default     = 50
}

variable "marketing_hosting_site_id" {
  description = "Firebase Hosting site id for the marketing site, in var.project_id. Globally unique across Firebase."
  type        = string
  default     = "thesomnus-web"
}

variable "app_hosting_site_id" {
  description = "Firebase Hosting site id for the app SPA, in var.project_id. Globally unique across Firebase."
  type        = string
  default     = "thesomnus-app"
}

variable "console_hosting_site_id" {
  description = "Firebase Hosting site id for the admin console, in var.project_id. Globally unique across Firebase."
  type        = string
  default     = "thesomnus-console"
}

variable "github_repository_id" {
  description = "Numeric id of 0n4medur4n/the-somnus-platform; the only repository whose Actions may deploy Hosting."
  type        = string
  default     = "1307769443"
}

variable "github_repository_owner_id" {
  description = "Numeric id of the repository owner, checked alongside the repository id."
  type        = string
  default     = "126766587"
}
