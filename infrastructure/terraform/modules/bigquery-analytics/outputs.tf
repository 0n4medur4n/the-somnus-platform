output "dataset_id" {
  value = google_bigquery_dataset.analytics.dataset_id
}

output "audit_table_id" {
  value = google_bigquery_table.audit_events.table_id
}
