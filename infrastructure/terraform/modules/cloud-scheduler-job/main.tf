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
    http_method = "POST"
    uri         = var.http_uri

    oidc_token {
      service_account_email = var.oidc_service_account_email
    }
  }

  retry_config {
    retry_count = 3
  }
}
