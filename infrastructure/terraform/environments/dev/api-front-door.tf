# --- api.thesomnus.com: the API's same-site front door (2026-10-05) ---
#
# Why this exists. The SPAs run on app.thesomnus.com and console.thesomnus.com;
# edge-api's own URL is *.run.app, a different site. A session cookie set by
# *.run.app is therefore a third-party cookie, and third-party cookies are
# blocked by default in Safari and every iOS browser -- including the in-app
# browser Gmail opens magic links in -- and by any Chrome or Firefox user who
# turns them off. Sign-in silently fails there.
#
# Served from api.thesomnus.com instead, the cookie is first-party to both SPAs
# (same registrable domain), so it works everywhere with SameSite=Lax.
#
# Why Firebase Hosting and not the other routes, all checked on 2026-10-05:
#   - Cloud Run domain mappings: not offered in europe-west3, and Google marks
#     them preview / not production-ready.
#   - A global external Application Load Balancer: works, but ~18-20 USD/month
#     for a forwarding rule; build plan §2 puts cost first. Chosen against.
#   - A rewrite from the existing app/console Hosting sites: impossible, those
#     live in var.firebase_project_id and a Hosting rewrite can only reach a
#     Cloud Run service in its own project (the `run` rewrite has no project
#     field).
# So: one more Hosting site, in THIS project, whose only job is to proxy every
# request to somnus-edge-api. It serves no files and adds no deployable.
#
# Consequence the code already accounts for: Hosting forwards exactly one
# cookie to Cloud Run, `__session`, and strips the rest. edge-api sets only that
# cookie and derives its CSRF token from the session instead of keeping a second
# cookie (services/somnus-edge-api/src/bootstrap/csrf-token.ts).
#
# DNS is manual, like console.thesomnus.com: after apply, add the records in the
# `api_domain_dns_records` output at Cloudflare as DNS-only (grey cloud). A
# proxied record breaks Hosting's certificate provisioning.

# Firebase on the backend project, needed only so it can own a Hosting site.
# If this project was already added to Firebase by hand, apply fails with
# "already exists"; import it instead of letting it collide:
#   terraform import google_firebase_project.backend projects/the-somnus
resource "google_firebase_project" "backend" {
  provider = google-beta
  project  = var.project_id

  depends_on = [module.project_apis_backend]
}

resource "google_firebase_hosting_site" "api" {
  provider = google-beta
  project  = var.project_id
  # Site ids are globally unique across all of Firebase. If this one is taken,
  # apply fails naming it; change the variable, nothing else depends on it.
  site_id = var.api_hosting_site_id

  depends_on = [google_firebase_project.backend]
}

# The site's whole configuration: every path, every method, to edge-api. No
# static files. Hosting marks dynamic responses `Cache-Control: private` by
# default, so nothing personal is cached at the CDN.
resource "google_firebase_hosting_version" "api" {
  provider = google-beta
  site_id  = google_firebase_hosting_site.api.site_id

  config {
    rewrites {
      glob = "**"
      run {
        service_id = module.run_edge_api.service_name
        region     = var.region
      }
    }
  }
}

resource "google_firebase_hosting_release" "api" {
  provider     = google-beta
  site_id      = google_firebase_hosting_site.api.site_id
  version_name = google_firebase_hosting_version.api.name
  message      = "${var.api_domain} -> ${module.run_edge_api.service_name} (${var.region})"
}

resource "google_firebase_hosting_custom_domain" "api" {
  provider      = google-beta
  project       = var.project_id
  site_id       = google_firebase_hosting_site.api.site_id
  custom_domain = var.api_domain

  # The records are added by hand at Cloudflare after apply; do not block the
  # apply waiting for DNS that cannot exist yet.
  wait_dns_verification = false
}

output "api_domain_dns_records" {
  description = "Add these at Cloudflare for var.api_domain, DNS-only (grey cloud), then wait for the certificate."
  value       = google_firebase_hosting_custom_domain.api.required_dns_updates
}

output "api_hosting_default_url" {
  description = "The site's default URL, usable to test the proxy before DNS is in place."
  value       = google_firebase_hosting_site.api.default_url
}
