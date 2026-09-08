variable "project_id" {
  type = string
}

variable "dataset_id" {
  type        = string
  description = "BigQuery dataset holding the privacy-safe analytics events."
}

variable "audit_table_id" {
  type        = string
  description = "Table receiving the redacted audit export rows."
  default     = "audit_events"
}

variable "location" {
  type        = string
  description = "Dataset location. EU by default: the platform's data stays in the EU (DPIA)."
  default     = "EU"
}

variable "writer_members" {
  type        = list(string)
  description = "Members allowed to append rows (the worker runtime service account)."
  default     = []
}

variable "reader_members" {
  type        = list(string)
  description = "Members allowed to read the dataset (dashboards, Phase 15)."
  default     = []
}

variable "labels" {
  type    = map(string)
  default = {}
}
