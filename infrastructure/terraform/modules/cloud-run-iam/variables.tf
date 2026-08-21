variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "service_name" {
  description = "The private Cloud Run service being granted access to."
  type        = string
}

variable "invoker_members" {
  description = "IAM members (e.g. \"serviceAccount:edge-api@project.iam.gserviceaccount.com\") allowed to invoke this private service. Never include allUsers here -- that is the `public` flag on the cloud-run-service module."
  type        = list(string)
}
