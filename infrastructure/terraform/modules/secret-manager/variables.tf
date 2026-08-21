variable "project_id" {
  type = string
}

variable "region" {
  description = "Region for the secret replica. A single region is enough for dev; consider automatic (multi-region) replication for production."
  type        = string
}

variable "secrets" {
  description = <<-EOT
    Map of secret_id => { accessor_members = [...] }. Creates an empty
    secret container only -- values are never set by Terraform (build
    plan: no secrets committed). Populate versions out-of-band with
    `gcloud secrets versions add` or Secret Manager console.
  EOT
  type = map(object({
    accessor_members = list(string)
  }))
  default = {}
}
