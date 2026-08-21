variable "project_id" {
  type = string
}

variable "display_name" {
  type = string
}

variable "combiner" {
  type    = string
  default = "OR"
}

variable "notification_channels" {
  type    = list(string)
  default = []
}

variable "condition_display_name" {
  type = string
}

variable "filter" {
  description = "Cloud Monitoring filter (MQL/legacy filter string) selecting the metric/resource this condition watches."
  type        = string
}

variable "comparison" {
  type    = string
  default = "COMPARISON_GT"
}

variable "threshold_value" {
  type = number
}

variable "duration" {
  description = "How long the condition must hold before firing, e.g. \"300s\"."
  type        = string
  default     = "300s"
}

variable "alignment_period" {
  type    = string
  default = "60s"
}

variable "per_series_aligner" {
  type    = string
  default = "ALIGN_RATE"
}

variable "documentation" {
  description = <<-EOT
    Notes shown in the alert notification. Build plan §20 Checkpoint
    13.3 re-tunes real thresholds from observed production baselines;
    this dev-environment condition is a deliberately conservative
    placeholder, not a tuned SLO.
  EOT
  type        = string
}
