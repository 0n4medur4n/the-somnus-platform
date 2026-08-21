resource "google_monitoring_alert_policy" "this" {
  project      = var.project_id
  display_name = var.display_name
  combiner     = var.combiner

  notification_channels = var.notification_channels

  conditions {
    display_name = var.condition_display_name

    condition_threshold {
      filter          = var.filter
      comparison      = var.comparison
      threshold_value = var.threshold_value
      duration        = var.duration

      aggregations {
        alignment_period   = var.alignment_period
        per_series_aligner = var.per_series_aligner
      }
    }
  }

  documentation {
    content   = var.documentation
    mime_type = "text/markdown"
  }
}
