# Enables the GCP APIs the platform depends on (build plan §3.8).
# One resource per API so `terraform plan` shows exactly what changes
# when the list grows in a later checkpoint.

resource "google_project_service" "this" {
  for_each = toset(var.apis)

  project                    = var.project_id
  service                    = each.value
  disable_on_destroy         = var.disable_on_destroy
  disable_dependent_services = false
}
