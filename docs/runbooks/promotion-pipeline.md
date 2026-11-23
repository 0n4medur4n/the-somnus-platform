# Runbook: promotion pipeline

ADR 0030. `deploy.yml` builds a changed service image on a push to `main`.
It publishes a Cloud Run revision only when a person runs the workflow
(`workflow_dispatch`) and names one service. The only environment is `dev`.

Until the repository variable `ARTIFACTS_PROJECT_ID` is set, the detect job
skips every later job. Do not set that variable until the Terraform in
`infrastructure/terraform/environments/dev/ci-cloud-run.tf` has been applied.

Dispatch inputs are read from the step environment and checked in the
shell before they are used. `image_tag`, when set, must be 7 to 40 hex
characters. The service name must be one of the five services.

## Already in the dev project

- Artifact Registry repository `somnus` in `europe-west3`.
- Workload Identity pool `github-actions` and provider `the-somnus-platform`.
  The provider rejects any other repository. The two new accounts can be
  assumed only when the mapped attribute is this repository id and
  `refs/heads/main` together.
- `ci-hosting-deployer`, used by `ci.yml` for Firebase Hosting only.
- GitHub environment `dev`, with no required reviewers. Staging and
  production environments are not created. The human gate is the dispatch.

## Still set by hand, after apply

Repository variables: `ARTIFACTS_PROJECT_ID` (`the-somnus`),
`ARTIFACTS_REGION` (`europe-west3`).

Repository secrets: `BUILD_WIF_PROVIDER`, `BUILD_WIF_SERVICE_ACCOUNT`
(the `ci-image-builder` email). The provider name is the Terraform output
`ci_cloud_run_auth.workload_identity_provider`.

Environment `dev` variable `PROJECT_ID` = `the-somnus`. Environment secret
`WIF_PROVIDER` (same provider) and `WIF_SERVICE_ACCOUNT` (the
`ci-run-deployer` email).

## What a push to main does once the variable is set

It builds and pushes images for the services whose files changed. It does
not deploy them. Hosting continues to deploy from `ci.yml`.

A dispatch with `service=somnus-edge-api` and an empty image tag builds
that one image and, after it is Ready, sends traffic with `--to-latest`.
A dispatch with an image tag skips the build and deploys that tag.
See `deploy-dev.md` for what that does to later deploys and to Terraform.
