# One Docker repository holds every service's images, distinguished by
# image path (e.g. somnus-edge-api, somnus-identity-service, ...). A
# per-service registry is unnecessary operational overhead at this scale.

resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  description   = var.description
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  # Keep the 10 most recent tagged versions per image; untagged images
  # older than 7 days are removed. Keeps registry storage cost bounded
  # without deleting anything a rollback might need.
  cleanup_policies {
    id     = "keep-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }
}
