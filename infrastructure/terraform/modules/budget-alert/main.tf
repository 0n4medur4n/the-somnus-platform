# Build plan §2: budget alerts are configured in every environment from
# Phase 5. This does not stop spend on its own (Cloud Billing budgets are
# alert-only unless wired to a Pub/Sub-triggered shutdown, which the
# build plan does not call for) -- it notifies billing admins by email
# plus any extra notification channels passed in.

data "google_project" "this" {
  project_id = var.project_id
}

resource "google_billing_budget" "this" {
  billing_account = var.billing_account_id
  display_name    = var.display_name

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.currency_code
      units         = tostring(var.budget_amount_units)
    }
  }

  dynamic "threshold_rules" {
    for_each = var.alert_thresholds
    content {
      threshold_percent = threshold_rules.value
    }
  }

  # Only set when there is something to actually configure: the API
  # does not persist a rule equivalent to its own defaults (empty
  # channels, default IAM recipients), which otherwise causes Terraform
  # to perpetually re-propose adding a block that never sticks.
  dynamic "all_updates_rule" {
    for_each = length(var.notification_channels) > 0 ? [1] : []
    content {
      monitoring_notification_channels = var.notification_channels
      disable_default_iam_recipients   = false
    }
  }
}
