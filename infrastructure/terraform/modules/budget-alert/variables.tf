variable "billing_account_id" {
  description = "Billing account ID linked to the project (format XXXXXX-XXXXXX-XXXXXX)."
  type        = string
}

variable "project_id" {
  type = string
}

variable "display_name" {
  type    = string
  default = "The Somnus - dev monthly budget"
}

variable "budget_amount_units" {
  description = "Monthly budget in whole currency units (build plan §2: cost takes priority over latency)."
  type        = number
  default     = 50
}

variable "currency_code" {
  type    = string
  default = "EUR"
}

variable "alert_thresholds" {
  description = "Fractions of the budget that trigger an alert (0.5 = 50%)."
  type        = list(number)
  default     = [0.5, 0.9, 1.0]
}

variable "notification_channels" {
  description = "Monitoring notification channel IDs to notify in addition to the default billing-admin emails."
  type        = list(string)
  default     = []
}
