variable "project_id" {
  type = string
}

variable "topic_id" {
  type = string
}

variable "message_retention_duration" {
  type    = string
  default = "86400s" # 1 day
}

variable "publisher_members" {
  type    = list(string)
  default = []
}

variable "subscriptions" {
  description = "Map of subscription_id => { push_endpoint = optional(string), oidc_service_account_email = optional(string), ack_deadline_seconds = optional(number) }. Omit push_endpoint for a pull subscription."
  type = map(object({
    push_endpoint              = optional(string)
    oidc_service_account_email = optional(string)
    ack_deadline_seconds       = optional(number, 20)
  }))
  default = {}
}
