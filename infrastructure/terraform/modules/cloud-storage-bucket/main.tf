# Build plan §9: Cloud Storage holds generated PDF reports, private
# exports, controlled attachments. Never public; access uses
# authenticated endpoints and short-lived signed URLs.

resource "google_storage_bucket" "this" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.region
  uniform_bucket_level_access = var.uniform_bucket_level_access
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = var.versioning
  }

  dynamic "soft_delete_policy" {
    for_each = var.soft_delete_retention_seconds == null ? [] : [var.soft_delete_retention_seconds]
    content {
      retention_duration_seconds = soft_delete_policy.value
    }
  }

  # Old noncurrent versions age out; current objects are governed by
  # each service's own retention logic, not a blanket bucket rule.
  # This rule is unconditional: callers do not replace it.
  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # Opt-in. Null (the default) adds nothing, so existing buckets keep the
  # archived-version rule above and no other.
  dynamic "lifecycle_rule" {
    for_each = var.delete_live_objects_after_days == null ? [] : [var.delete_live_objects_after_days]
    content {
      condition {
        age        = lifecycle_rule.value
        with_state = "LIVE"
      }
      action {
        type = "Delete"
      }
    }
  }

  # Literal on purpose. Terraform reads lifecycle before it evaluates
  # expressions, so prevent_destroy cannot be a variable. Every bucket
  # this module creates is protected, including the reports bucket and
  # the staging and production copies of reports and profile photos, not
  # only the three dev buckets named on 2026-11-11. A plan that would
  # destroy one fails.
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_storage_bucket_iam_member" "writer" {
  for_each = toset(var.writer_members)

  bucket = google_storage_bucket.this.name
  role   = "roles/storage.objectAdmin"
  member = each.value
}

resource "google_storage_bucket_iam_member" "reader" {
  for_each = toset(var.reader_members)

  bucket = google_storage_bucket.this.name
  role   = "roles/storage.objectViewer"
  member = each.value
}
