output "artifact_registry_url" {
  value = module.env.artifact_registry_url
}

output "cloud_run_urls" {
  value = module.env.cloud_run_urls
}

output "service_account_emails" {
  value = module.env.service_account_emails
}

output "reports_bucket_name" {
  value = module.env.reports_bucket_name
}

output "firebase_hosting_sites" {
  value = module.env.firebase_hosting_sites
}

output "firebase_hosting_urls" {
  value = module.env.firebase_hosting_urls
}
