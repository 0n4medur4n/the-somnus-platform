variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "queue_id" {
  type = string
}

variable "max_dispatches_per_second" {
  type    = number
  default = 10
}

variable "max_concurrent_dispatches" {
  type    = number
  default = 10
}

variable "max_attempts" {
  description = "Build plan §5.7: the notification module needs retries with a max-attempts / dead-letter policy."
  type        = number
  default     = 5
}

variable "min_backoff" {
  type    = string
  default = "5s"
}

variable "max_backoff" {
  type    = string
  default = "300s"
}
