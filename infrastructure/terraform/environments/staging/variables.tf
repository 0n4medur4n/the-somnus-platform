variable "project_id" {
  description = "GCP project ID for staging backend infra."
  type        = string
}

variable "firebase_project_id" {
  description = "GCP project ID hosting staging Firebase (separate from project_id)."
  type        = string
}

variable "billing_account_id" {
  description = "Billing account ID linked to both staging projects (format XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "region" {
  description = "Build plan §3.8: europe-west3 for every environment."
  type        = string
  default     = "europe-west3"
}

variable "env" {
  type    = string
  default = "staging"
}

variable "marketing_site_id" {
  description = "Firebase Hosting site ID for the staging marketing frontend (globally unique)."
  type        = string
}

variable "app_site_id" {
  description = "Firebase Hosting site ID for the staging SPA (globally unique)."
  type        = string
}

variable "budget_amount_units" {
  description = "Monthly budget in whole currency units for the staging backend project."
  type        = number
  default     = 100
}

variable "firebase_budget_amount_units" {
  description = "Monthly budget in whole currency units for the staging Firebase project."
  type        = number
  default     = 20
}

variable "edge_5xx_threshold" {
  description = "somnus-edge-api sustained-5xx alert threshold (responses/min), re-tuned from the load test."
  type        = number
  default     = 5
}
