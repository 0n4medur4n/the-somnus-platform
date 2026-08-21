output "artifact_registry_url" {
  value = module.artifact_registry.repository_url
}

output "cloud_run_urls" {
  value = {
    edge_api = module.run_edge_api.url
    identity = module.run_identity.url
    morpheo  = module.run_morpheo.url
    report   = module.run_report.url
    worker   = module.run_worker.url
  }
}

output "service_account_emails" {
  value = {
    edge_api = module.sa_edge_api.email
    identity = module.sa_identity.email
    morpheo  = module.sa_morpheo.email
    report   = module.sa_report.email
    worker   = module.sa_worker.email
  }
}

output "reports_bucket_name" {
  value = module.reports_bucket.bucket_name
}

output "firebase_hosting_sites" {
  value = {
    marketing = module.hosting_marketing.site_id
    app       = module.hosting_app.site_id
  }
}

output "firebase_hosting_urls" {
  value = {
    marketing = module.hosting_marketing.default_url
    app       = module.hosting_app.default_url
  }
}
