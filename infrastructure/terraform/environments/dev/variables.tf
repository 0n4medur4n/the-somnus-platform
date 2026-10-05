variable "project_id" {
  description = "GCP project ID for backend infra: Cloud Run, Artifact Registry, service accounts, Secret Manager, Cloud Tasks, Pub/Sub, Cloud Scheduler, Cloud Storage."
  type        = string
}

variable "firebase_project_id" {
  description = "GCP project ID hosting Firebase: Hosting sites, Authentication, Firestore. Deliberately separate from project_id -- matches the project already referenced in .firebaserc and package.json's deploy scripts."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID linked to both project_id and firebase_project_id (format XXXXXX-XXXXXX-XXXXXX). Required for the budget-alert modules."
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

variable "firebase_budget_amount_units" {
  description = "Monthly budget in whole currency units for firebase_project_id. Smaller default: Hosting/Auth stay mostly within the free tier."
  type        = number
  default     = 10
}

variable "api_domain" {
  description = "The API's same-site public hostname, fronted by Firebase Hosting (see api-front-door.tf)."
  type        = string
  default     = "api.thesomnus.com"
}

variable "api_hosting_site_id" {
  description = "Firebase Hosting site id for the API front door. Globally unique across Firebase."
  type        = string
  default     = "the-somnus-api"
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
