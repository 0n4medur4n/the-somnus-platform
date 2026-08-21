variable "project_id" {
  description = "GCP project ID for production backend infra."
  type        = string
}

variable "firebase_project_id" {
  description = "GCP project ID hosting production Firebase (separate from project_id)."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID linked to both production projects (format XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "region" {
  description = "Build plan §3.8: europe-west3 for every environment."
  type        = string
  default     = "europe-west3"
}

variable "env" {
  type    = string
  default = "production"
}

variable "marketing_site_id" {
  description = "Firebase Hosting site ID for the production marketing frontend (globally unique)."
  type        = string
}

variable "app_site_id" {
  description = "Firebase Hosting site ID for the production SPA (globally unique)."
  type        = string
}

variable "budget_amount_units" {
  description = "Monthly budget in whole currency units for the production backend project."
  type        = number
  default     = 200
}

variable "firebase_budget_amount_units" {
  description = "Monthly budget in whole currency units for the production Firebase project."
  type        = number
  default     = 40
}

variable "edge_5xx_threshold" {
  description = "somnus-edge-api sustained-5xx alert threshold (responses/min), re-tuned from the load test."
  type        = number
  default     = 5
}
