# Runbook: deploy to dev

The five Cloud Run services are created and configured in
`infrastructure/terraform/environments/dev`. Environment variables, secrets,
scaling and IAM change only through Terraform. The container image is the
exception: `modules/cloud-run-service` ignores
`template.containers.image`, so a pipeline deploy does not get rolled back
by the next apply.

## Traffic

`google_cloud_run_v2_service` in that module sets no `traffic` block.
Provider 6.50.0 treats an omitted block as 100% of traffic to the latest
Ready revision. `lifecycle.ignore_changes` lists the image, `client` and
`client_version`. It does not list `traffic`.

The pipeline (`deploy-environment.yml`) deploys with `--no-traffic`, waits
until the new revision is Ready, checks it is still
`status.latestCreatedRevisionName`, and then runs
`gcloud run services update-traffic --to-latest`.

`--to-latest` is the same as sending 100% to `LATEST`. Later plain
`gcloud run deploy` commands receive traffic automatically. A pin
(`--to-revisions <revision>=100`) does the opposite: Cloud Run keeps that
split, and a later plain deploy creates a revision that gets no traffic
until someone runs `--to-latest` again.

Because the module's default and `--to-latest` are the same allocation
(latest Ready revision, 100%), a pipeline deploy should not show a traffic
diff on the next `terraform plan`. A pin would: the live service would
name a revision, and the configuration would want the latest Ready
revision back. Do not add `traffic` to `ignore_changes` to hide that.
A rollback that pins on purpose is documented in `rollback.md`.
