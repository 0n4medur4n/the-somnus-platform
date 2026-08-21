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

  # Old noncurrent versions age out; current objects are governed by
  # each service's own retention logic, not a blanket bucket rule.
  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
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
