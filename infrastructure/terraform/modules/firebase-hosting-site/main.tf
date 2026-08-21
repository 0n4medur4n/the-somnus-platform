# Firebase Hosting resources are only available on the google-beta
# provider; the caller must pass `providers = { google-beta = google-beta }`.

resource "google_firebase_hosting_site" "this" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.site_id
}
