variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "service_name" {
  description = "Cloud Run service name, e.g. somnus-edge-api."
  type        = string
}

variable "service_account_email" {
  description = "Runtime service account email (least privilege, one per service)."
  type        = string
}

variable "image" {
  description = <<-EOT
    Container image to deploy. Defaults to Google's public placeholder
    image so Terraform can create the service shell before CI/CD has
    ever pushed a real image (build plan Phase 13.3). Once a real
    deploy pipeline updates the image, Terraform ignores drift on this
    field (see lifecycle block) so plan/apply stop fighting CI/CD over it.
  EOT
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello:latest"
}

variable "public" {
  description = "If true, ingress allows all traffic and allUsers gets run.invoker (only somnus-edge-api should set this). If false, ingress is internal-only and callers need an explicit IAM binding (see the cloud-run-iam module)."
  type        = bool
  default     = false
}

variable "min_instance_count" {
  description = "Minimum instances. Build plan §2: zero everywhere, no exceptions without a new decision."
  type        = number
  default     = 0

  validation {
    condition     = var.min_instance_count == 0
    error_message = "Build plan §2: min instances must be 0 for every Cloud Run service. Do not override without a documented, pre-approved exception."
  }
}

variable "max_instance_count" {
  type    = number
  default = 3
}

variable "cpu" {
  type    = string
  default = "1"
}

variable "memory" {
  type    = string
  default = "512Mi"
}

variable "port" {
  description = "Container port. Build plan behavioral rule: services read PORT from the environment, default 8080."
  type        = number
  default     = 8080
}

variable "env_vars" {
  description = "Plain (non-secret) environment variables."
  type        = map(string)
  default     = {}
}

variable "secret_env_vars" {
  description = <<-EOT
    Environment variables sourced from Secret Manager, as
    { ENV_VAR_NAME = { secret_id = "...", version = "latest" } }.
    Never put a secret value directly in env_vars.
  EOT
  type = map(object({
    secret_id = string
    version   = optional(string, "latest")
  }))
  default = {}
}

variable "startup_probe_path" {
  description = "HTTP path for the startup probe (e.g. /health/live). Null disables the custom probe and falls back to Cloud Run's default TCP probe -- required until a real image implementing the path is deployed (the bootstrap placeholder image does not)."
  type        = string
  default     = null
}

variable "labels" {
  type    = map(string)
  default = {}
}
