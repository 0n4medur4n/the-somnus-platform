# Generic HTTP Cloud Scheduler job. Build plan §5.7 names two concrete
# jobs (unclaimed-assessment cleanup, expired claim-token cleanup) that
# call into somnus-worker; neither is instantiated until Phase 12.2
# creates the endpoints they call (calling a URL that 404s is worse
# than not having the job yet).

resource "google_cloud_scheduler_job" "this" {
  project   = var.project_id
  region    = var.region
  name      = var.job_id
  schedule  = var.schedule
  time_zone = var.time_zone
  paused    = var.paused

  http_target {
    http_method = var.http_method
    uri         = var.http_uri

    # A public target (the edge-api keep-warm ping) needs no token.
    dynamic "oidc_token" {
      for_each = var.oidc_service_account_email == null ? [] : [var.oidc_service_account_email]
      content {
        service_account_email = oidc_token.value
        # Cloud Run checks the token's audience against the service URL; the
        # default (the full target URI, path included) is not that.
        audience = var.oidc_audience
      }
    }
  }

  retry_config {
    retry_count = 3
  }
}
