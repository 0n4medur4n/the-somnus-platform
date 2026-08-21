variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "job_id" {
  type = string
}

variable "schedule" {
  description = "Unix-cron schedule, e.g. \"0 3 * * *\"."
  type        = string
}

variable "time_zone" {
  type    = string
  default = "Europe/Madrid"
}

variable "http_uri" {
  description = "Target HTTPS endpoint (a private Cloud Run service's URL)."
  type        = string
}

variable "oidc_service_account_email" {
  description = "Service account whose OIDC token authenticates the call -- the target Cloud Run service must grant it roles/run.invoker (cloud-run-iam module)."
  type        = string
}

variable "paused" {
  description = "Create the job in a paused state. Use this when the target endpoint does not exist yet."
  type        = bool
  default     = false
}
