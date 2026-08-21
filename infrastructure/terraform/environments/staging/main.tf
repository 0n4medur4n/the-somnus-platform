# Staging is a thin wrapper over the shared environment module: one composition,
# configured per environment. min-instances 0 is enforced inside the module.

module "env" {
  source = "../../modules/environment"

  # The module manages Firebase resources on the google-beta provider, so both
  # providers are passed explicitly.
  providers = {
    google      = google
    google-beta = google-beta
  }

  project_id          = var.project_id
  firebase_project_id = var.firebase_project_id
  billing_account_id  = var.billing_account_id
  region              = var.region
  env                 = var.env

  marketing_site_id = var.marketing_site_id
  app_site_id       = var.app_site_id

  budget_amount_units          = var.budget_amount_units
  firebase_budget_amount_units = var.firebase_budget_amount_units

  edge_5xx_threshold = var.edge_5xx_threshold
}
