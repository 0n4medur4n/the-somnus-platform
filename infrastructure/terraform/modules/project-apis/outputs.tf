output "enabled_apis" {
  description = "The API service names that were enabled."
  value       = [for s in google_project_service.this : s.service]
}

output "api_resources" {
  description = "The full google_project_service resources, keyed by API name (for depends_on in callers)."
  value       = google_project_service.this
}
