variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "Region for the repository (build plan §3.8: europe-west3)."
  type        = string
}

variable "repository_id" {
  description = "Artifact Registry repository ID."
  type        = string
  default     = "somnus"
}

variable "description" {
  description = "Human-readable description of the repository."
  type        = string
  default     = "Docker images for The Somnus platform's Cloud Run services."
}
