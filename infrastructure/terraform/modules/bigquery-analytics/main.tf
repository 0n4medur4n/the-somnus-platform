# Build plan §9: BigQuery holds product analytics, funnel metrics, aggregate
# operational data, privacy-safe events. It must never receive names, email
# addresses, full questionnaire answers, health-related free text, report
# content, or authentication tokens.
#
# The table schema below is the last line of that defence: it is the redacted
# row the worker's Audit module emits (`AuditExportRow`) and nothing else. A
# field that is not declared here cannot be inserted, because streaming inserts
# are rejected for unknown fields -- so a producer that started leaking a name
# would fail the insert instead of quietly populating a new column.

resource "google_bigquery_dataset" "analytics" {
  project                    = var.project_id
  dataset_id                 = var.dataset_id
  friendly_name              = "Somnus privacy-safe analytics"
  description                = "Redacted audit events for funnel and operational metrics (build plan §9 / §5.7). No PII, no health data."
  location                   = var.location
  delete_contents_on_destroy = false

  labels = var.labels
}

resource "google_bigquery_table" "audit_events" {
  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  table_id   = var.audit_table_id

  # A dropped analytics table is unrecoverable history; deleting it has to be a
  # deliberate act, not a side effect of a plan.
  deletion_protection = true

  description = "One row per exported audit event, already redacted by the worker (no actor/subject ids, no forbidden fields)."

  time_partitioning {
    type  = "DAY"
    field = "occurredAt"
  }

  clustering = ["eventType", "producer"]

  schema = jsonencode([
    {
      name        = "eventId"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Opaque event id; also the streaming insertId, so a redelivery cannot double-count."
    },
    {
      name        = "eventType"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "§17 event type, e.g. identity.registration.completed.v1."
    },
    {
      name = "occurredAt"
      type = "TIMESTAMP"
      mode = "REQUIRED"
    },
    {
      name = "producer"
      type = "STRING"
      mode = "REQUIRED"
    },
    {
      name = "correlationId"
      type = "STRING"
      mode = "REQUIRED"
    },
    {
      name        = "actorType"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Provenance TYPE only. The actor id is dropped before export."
    },
    {
      name        = "subjectType"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Provenance TYPE only. The subject id is dropped before export."
    },
    {
      name        = "data"
      type        = "JSON"
      mode        = "NULLABLE"
      description = "Redacted payload. For an analytics event this is the event's strict contract: a role branch or an opaque entity id, never PII."
    },
  ])
}

# Scoped to the dataset, not the project: the worker may append its redacted
# rows here and has no BigQuery access anywhere else.
resource "google_bigquery_dataset_iam_member" "writers" {
  for_each = toset(var.writer_members)

  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = each.value
}

# Dashboards read; they never write.
resource "google_bigquery_dataset_iam_member" "readers" {
  for_each = toset(var.reader_members)

  project    = var.project_id
  dataset_id = google_bigquery_dataset.analytics.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = each.value
}
