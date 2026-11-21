# ADR 0023 — CI deploys Cloud Run revisions; Terraform does not

- Status: Accepted
- Date: 2026-11-21
- Decides: build plan Checkpoint 13.3, §21

## Context

Cloud Run images were built and deployed by hand. `deploy.yml` already
builds an image once and can promote it, but it no-ops while the repository
variable `ARTIFACTS_PROJECT_ID` is unset. Terraform ignores
`template.containers.image` so that a later apply does not roll a service
back to the placeholder image.

The `dev` GitHub environment exists and has no required reviewers. Staging
and production environments do not exist. A merge must not be able to move
traffic by itself.

## Decision

Two identities, both bound to the existing `github-actions` Workload
Identity pool and restricted to this repository:

- `ci-image-builder` may write the `somnus` Artifact Registry repository.
- `ci-run-deployer` may deploy Cloud Run revisions (`roles/run.developer`),
  read that repository, and act as the five runtime service accounts.
  It is not Editor, Owner, or `roles/run.admin`.

A push to `main` may build and push the changed service images. Publishing
a revision requires a person to run the workflow (`workflow_dispatch`) and
to name one service and one environment. The workflow creates the revision
with no traffic, waits until it is Ready, and only then sends traffic to
it. A revision that does not boot keeps the previous revision at 100%.

GitHub variables and secrets are set by hand after the Terraform apply.
Setting `ARTIFACTS_PROJECT_ID` is what turns the pipeline on.

## Consequences

- Terraform apply does not deploy an image.
- Rollback remains a traffic switch to the previous revision.
- Hosting stays on the existing `ci-hosting-deployer` path. This decision
  does not grant the new identity Hosting admin.
