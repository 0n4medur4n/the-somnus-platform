# --- One project per environment: Firebase moves into the backend project (2026-10-05) ---
#
# Until now dev was split across two GCP projects: the backend in
# var.project_id ("the-somnus") and Firebase -- Hosting, Authentication -- in
# var.firebase_project_id ("the-somnuss"). The split was never an architectural
# decision; the Firebase project simply existed first. It cost three incidents:
# the session Firestore pointed at the wrong project, a Hosting site could not
# reach Cloud Run in the other project, and the console showed two Firebase
# projects with the same display name.
#
# Google's and Firebase's own guidance is one project per environment. This file
# builds everything Firebase needs inside var.project_id, next to the services:
#
#   - Authentication (email-link sign-in), via Identity Platform.
#   - The web app registration whose public config the SPAs ship.
#   - Hosting sites for marketing, the app and the console. The app and the
#     console rewrite /v1/** to somnus-edge-api (firebase.json), so the API is
#     same-origin with each SPA: a first-party session cookie in every browser,
#     Safari and iOS included, and no CORS at all.
#   - The identity CI deploys Hosting as, reached from GitHub Actions through
#     Workload Identity Federation -- no service-account key exists to leak.
#
# The custom domains move in a later step, once the new sites are verified on
# their *.web.app URLs. var.firebase_project_id is retired after that.

# Workload Identity Federation exchanges GitHub's OIDC token through STS.
resource "google_project_service" "sts" {
  project            = var.project_id
  service            = "sts.googleapis.com"
  disable_on_destroy = false
}

# --- Authentication ---

# Identity Platform is Firebase Authentication's backend; creating its config is
# what turns Authentication on for the project. Email link only: the SPAs never
# ask for a password (build plan §10).
resource "google_identity_platform_config" "auth" {
  provider = google-beta
  project  = var.project_id

  sign_in {
    allow_duplicate_emails = false

    email {
      enabled           = true
      password_required = false
    }
  }

  # Where a sign-in link may send the browser back to. The *.web.app URLs are
  # here so the new sites can be tested before the custom domains move.
  authorized_domains = [
    "localhost",
    "${var.project_id}.firebaseapp.com",
    "${var.project_id}.web.app",
    "${var.app_hosting_site_id}.web.app",
    "${var.app_hosting_site_id}.firebaseapp.com",
    "${var.console_hosting_site_id}.web.app",
    "${var.console_hosting_site_id}.firebaseapp.com",
    "app.thesomnus.com",
    "console.thesomnus.com",
  ]

  depends_on = [google_firebase_project.backend]
}

# The web app registration. Its config -- API key, auth domain, app id -- is
# public by design and ships in both SPA bundles (apps/*/hosting.dev.json).
resource "google_firebase_web_app" "web" {
  provider     = google-beta
  project      = var.project_id
  display_name = "The Somnus web (app + console)"

  depends_on = [google_firebase_project.backend]
}

data "google_firebase_web_app_config" "web" {
  provider   = google-beta
  project    = var.project_id
  web_app_id = google_firebase_web_app.web.app_id
}

# --- Hosting ---

resource "google_firebase_hosting_site" "marketing" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.marketing_hosting_site_id

  depends_on = [google_firebase_project.backend]
}

resource "google_firebase_hosting_site" "app" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.app_hosting_site_id

  depends_on = [google_firebase_project.backend]
}

resource "google_firebase_hosting_site" "console" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.console_hosting_site_id

  depends_on = [google_firebase_project.backend]
}

# --- The identity CI deploys Hosting as ---

resource "google_service_account" "ci_hosting" {
  project      = var.project_id
  account_id   = "ci-hosting-deployer"
  display_name = "CI: deploys the three Firebase Hosting sites"
  description  = "Used only by GitHub Actions in 0n4medur4n/the-somnus-platform, through Workload Identity Federation. Has no key."
}

# Least privilege for `firebase deploy --only hosting`: manage Hosting releases,
# read the Firebase project, and read the Cloud Run service the /v1/** rewrites
# point at (the CLI checks a rewrite target exists before releasing).
resource "google_project_iam_member" "ci_hosting" {
  for_each = toset([
    "roles/firebasehosting.admin",
    "roles/firebase.viewer",
    "roles/run.viewer",
  ])

  project = var.project_id
  role    = each.value
  member  = google_service_account.ci_hosting.member
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
  description               = "OIDC tokens from GitHub Actions; see the provider for which repository is accepted."

  depends_on = [google_project_service.sts]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "the-somnus-platform"
  display_name                       = "the-somnus-platform"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository"
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  # Matched by numeric ids, not names: a renamed or re-created repository with
  # the same name must not inherit this trust.
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "ci_hosting_wif" {
  service_account_id = google_service_account.ci_hosting.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

# --- Outputs ---

output "firebase_web_config" {
  description = "Public Firebase web config for apps/*/hosting.dev.json. Public by design; not a secret."
  value = {
    project_id  = var.project_id
    app_id      = google_firebase_web_app.web.app_id
    auth_domain = data.google_firebase_web_app_config.web.auth_domain
    api_key     = data.google_firebase_web_app_config.web.api_key
  }
  sensitive = true
}

output "hosting_sites" {
  value = {
    marketing = google_firebase_hosting_site.marketing.default_url
    app       = google_firebase_hosting_site.app.default_url
    console   = google_firebase_hosting_site.console.default_url
  }
}

output "ci_hosting_auth" {
  description = "Values for google-github-actions/auth in .github/workflows/ci.yml. Identifiers, not secrets."
  value = {
    workload_identity_provider = google_iam_workload_identity_pool_provider.github.name
    service_account            = google_service_account.ci_hosting.email
  }
}
