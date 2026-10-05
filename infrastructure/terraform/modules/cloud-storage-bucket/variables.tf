variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "bucket_name" {
  description = "Globally-unique bucket name (GCS buckets share one global namespace)."
  type        = string
}

variable "writer_members" {
  description = "IAM members granted roles/storage.objectAdmin scoped to this bucket only (e.g. the report service's SA)."
  type        = list(string)
  default     = []
}

variable "reader_members" {
  description = "IAM members granted roles/storage.objectViewer scoped to this bucket only."
  type        = list(string)
  default     = []
}

variable "versioning" {
  type    = bool
  default = true
}

variable "soft_delete_retention_seconds" {
  description = "How long Cloud Storage keeps a deleted object recoverable. null keeps Google's default (7 days); 0 turns soft delete off, so a delete is final -- what personal data under the right to erasure needs."
  type        = number
  default     = null
}

variable "uniform_bucket_level_access" {
  description = "Build plan §9: buckets are never public; uniform access (no per-object ACLs) is the safer default."
  type        = bool
  default     = true
}
