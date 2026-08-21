variable "project_id" {
  description = "GCP project ID to enable APIs on."
  type        = string
}

variable "apis" {
  description = "List of API service names to enable (e.g. run.googleapis.com)."
  type        = list(string)
}

variable "disable_on_destroy" {
  description = "Whether `terraform destroy` disables the APIs. False by default: disabling a shared project API is rarely what you want."
  type        = bool
  default     = false
}
