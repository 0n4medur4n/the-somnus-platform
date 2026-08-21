variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "account_id" {
  description = "Service account ID (becomes account_id@project_id.iam.gserviceaccount.com)."
  type        = string
}

variable "display_name" {
  description = "Human-readable display name."
  type        = string
}

variable "description" {
  description = "What this service account runs as."
  type        = string
}

variable "project_roles" {
  description = <<-EOT
    Project-level IAM roles granted to this service account (least
    privilege: baseline observability roles plus whatever the specific
    service genuinely needs). Do not grant roles/editor or roles/owner.
  EOT
  type        = list(string)
  default     = []
}
