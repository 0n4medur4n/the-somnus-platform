output "repository_id" {
  value = google_artifact_registry_repository.docker.repository_id
}

output "repository_url" {
  description = "Base path to push/pull images, e.g. europe-west3-docker.pkg.dev/PROJECT/somnus."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}
