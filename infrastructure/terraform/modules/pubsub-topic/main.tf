resource "google_pubsub_topic" "this" {
  project                    = var.project_id
  name                       = var.topic_id
  message_retention_duration = var.message_retention_duration
}

resource "google_pubsub_topic_iam_member" "publisher" {
  for_each = toset(var.publisher_members)

  project = var.project_id
  topic   = google_pubsub_topic.this.name
  role    = "roles/pubsub.publisher"
  member  = each.value
}

resource "google_pubsub_subscription" "this" {
  for_each = var.subscriptions

  project = var.project_id
  name    = each.key
  topic   = google_pubsub_topic.this.name

  ack_deadline_seconds = each.value.ack_deadline_seconds

  dynamic "push_config" {
    for_each = each.value.push_endpoint == null ? [] : [each.value.push_endpoint]
    content {
      push_endpoint = push_config.value

      dynamic "oidc_token" {
        for_each = each.value.oidc_service_account_email == null ? [] : [each.value.oidc_service_account_email]
        content {
          service_account_email = oidc_token.value
        }
      }
    }
  }
}
