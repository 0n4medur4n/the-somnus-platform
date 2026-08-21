# Generic Cloud Run v2 service. Instantiated once per deployable
# (build plan §5: somnus-edge-api public, the other four private).

resource "google_cloud_run_v2_service" "this" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  # Public for the edge API only; every other service is reachable
  # solely from other Cloud Run services in this project (build plan
  # §5.3: "no direct calls to internal services" from anywhere else).
  ingress = var.public ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"

  labels = var.labels

  template {
    service_account = var.service_account_email

    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # No CPU throttling outside requests would defeat scale-to-zero
        # cost policy (build plan §2); keep the default (throttled).
      }

      ports {
        container_port = var.port
      }

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = env.value.version
            }
          }
        }
      }

      dynamic "startup_probe" {
        for_each = var.startup_probe_path == null ? [] : [var.startup_probe_path]
        content {
          http_get {
            path = startup_probe.value
            port = var.port
          }
          initial_delay_seconds = 0
          period_seconds        = 3
          failure_threshold     = 3
          timeout_seconds       = 2
        }
      }
    }
  }

  # KNOWN ISSUE (terraform-provider-google, google_cloud_run_v2_service):
  # every plan after the first apply proposes removing this exact
  # `scaling` block (manual_instance_count 0 -> null, min_instance_count
  # 0 -> null), even though nothing in var.min_instance_count changed
  # and the deployed service genuinely has min-instances = 0 (build
  # plan §2 -- enforced by the validation block on var.min_instance_count
  # above, so it is not possible to configure this any other way). The
  # API appears to echo a `manualInstanceCount` field back on read that
  # is not a real, settable attribute in this provider's schema (it
  # errors as "unsupported attribute" if referenced), so `ignore_changes`
  # cannot target it specifically, and ignoring the whole `scaling` block
  # was tried and did not suppress the diff either -- this looks like a
  # provider-level bug, not a config or real-infrastructure problem.
  # Re-applying this exact plan is a safe no-op; it does not change
  # min-instances away from 0.
  lifecycle {
    ignore_changes = [
      # CI/CD (build plan Phase 13.3) deploys new images with `gcloud
      # run deploy --image ...` outside Terraform; without this, the
      # next `terraform apply` would silently roll the service back to
      # var.image (the bootstrap placeholder).
      template[0].containers[0].image,
    ]
  }
}

# Only the public service gets allUsers; private services are invoked
# exclusively via explicit bindings created by the cloud-run-iam module.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.public ? 1 : 0

  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.this.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
