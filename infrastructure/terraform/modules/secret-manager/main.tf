resource "google_secret_manager_secret" "this" {
  for_each  = var.secrets
  project   = var.project_id
  secret_id = each.key

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each = merge([
    for secret_id, cfg in var.secrets : {
      for member in cfg.accessor_members :
      "${secret_id}:${member}" => {
        secret_id = secret_id
        member    = member
      }
    }
  ]...)

  project   = var.project_id
  secret_id = google_secret_manager_secret.this[each.value.secret_id].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}
