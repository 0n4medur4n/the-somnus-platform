# ADR 0030 — CI deploys Cloud Run revisions; Terraform does not

- Status: Accepted
- Date: 2026-11-21
- Decides: build plan Checkpoint 13.3, §21

## Context

Cloud Run images were built and deployed by hand. `deploy.yml` already
builds an image once and can promote it, but it no-ops while the repository
variable `ARTIFACTS_PROJECT_ID` is unset. Terraform ignores
`template.containers.image` so that a later apply does not roll a service
back to the placeholder image. The service module does not set a `traffic`
block, and the provider treats that as 100% to the latest Ready revision.

The `dev` GitHub environment exists and has no required reviewers. Staging
and production environments do not exist. A merge must not be able to move
traffic by itself.

## Decision

Two identities, both bound to the existing `github-actions` Workload
Identity pool. The provider still rejects a token from any other
repository. Each new binding matches one mapped attribute whose value is
this repository's id plus `refs/heads/main`, so a pull request, a tag, or
any other branch cannot assume them:

- `ci-image-builder` may write the `somnus` Artifact Registry repository.
- `ci-run-deployer` has `roles/run.developer` on each of the five Cloud Run
  services, reads that repository, and has `roles/iam.serviceAccountUser`
  on the five runtime accounts. That role is `actAs` for the deploy. It is
  not Token Creator, Editor, Owner, or `roles/run.admin`.

A push to `main` may build and push the changed service images. Publishing
a revision requires a person to run the workflow (`workflow_dispatch`) and
to name one service. The only environment is `dev`. The workflow creates
the revision with no traffic, waits until it is Ready, checks that it is
still the latest created revision, and then sends traffic with
`--to-latest`. A revision that does not boot keeps the previous revision
at 100%. A named pin (`--to-revisions REV=100`) is not used: it would stop
later plain deploys from receiving traffic.

GitHub variables and secrets are set by hand after the Terraform apply.
Setting `ARTIFACTS_PROJECT_ID` is what turns the pipeline on.

## Consequences

- Terraform apply does not deploy an image.
- After a pipeline deploy the service stays on "latest Ready revision",
  so a later plan of `google_cloud_run_v2_service` should not show a
  traffic diff. A rollback that pins a named revision can show one,
  because `traffic` is not in `ignore_changes`.
- Rollback remains a traffic switch to the previous revision, and that
  switch pins until someone runs `--to-latest` again.
- Hosting stays on the existing `ci-hosting-deployer` path. This decision
  does not grant the new identity Hosting admin.
