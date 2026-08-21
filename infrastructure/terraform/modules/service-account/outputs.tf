output "email" {
  value = google_service_account.this.email
}

output "name" {
  value = google_service_account.this.name
}

output "member" {
  description = "IAM member string, e.g. serviceAccount:foo@project.iam.gserviceaccount.com."
  value       = "serviceAccount:${google_service_account.this.email}"
}
