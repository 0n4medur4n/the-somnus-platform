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

  # Keep the 5 most recent versions per image for instant rollbacks, and delete
  # older tagged and untagged images after 7 days. In Artifact Registry, KEEP
  # policies always take precedence over DELETE policies; without a DELETE rule
  # covering TAGGED versions, CI-pushed commit-SHA tags accumulate indefinitely.
  cleanup_policies {
    id     = "keep-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
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

  cleanup_policies {
    id     = "delete-old-tagged"
    action = "DELETE"
    condition {
      tag_state  = "TAGGED"
      older_than = "604800s" # 7 days
    }
  }
}
