# Grants roles/run.invoker on a private Cloud Run service to specific
# callers only. Ingress ("internal only", set in cloud-run-service) picks
# the network path; this picks the identity -- both are required for a
# private service to be reachable at all (build plan §11: The Somnus
# authorizes the action, not just Firebase-level authentication).

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = toset(var.invoker_members)

  project  = var.project_id
  location = var.region
  name     = var.service_name
  role     = "roles/run.invoker"
  member   = each.value
}
