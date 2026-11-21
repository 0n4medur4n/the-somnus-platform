# Runbook: rollback

A bad Cloud Run deploy is a traffic switch back to the previous revision.
Roll back only the service that changed (ADR 0002, ADR 0023).

## Cloud Run

A deploy creates the new revision with `--no-traffic`. Traffic moves to it
only after that revision is Ready. If it never becomes Ready, the previous
revision still has 100% and there is nothing to switch.

When a Ready revision was given traffic and then misbehaves:

```bash
gcloud run revisions list --service <service> --region europe-west3 --project the-somnus
gcloud run services update-traffic <service> \
  --region europe-west3 --project the-somnus \
  --to-revisions <previous-revision>=100
```

Min-instances stays 0. Do not rebuild an image to roll back.
