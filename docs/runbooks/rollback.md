# Runbook: rollback

A bad Cloud Run deploy is a traffic switch back to the previous revision.
Roll back only the service that changed (ADR 0002, ADR 0030).

## Cloud Run

A deploy creates the new revision with `--no-traffic` and, only after that
revision is Ready and is still the latest created revision, returns the
service to `--to-latest`. That means the latest Ready revision has 100%
and a later plain `gcloud run deploy` receives traffic again.

`--no-traffic` by itself leaves the service pinned to the previous
revision. Google's deploy reference says that after a deployment with
`--no-traffic`, the latest revision does not receive traffic on future
deployments until `update-traffic --to-latest`. A named pin
(`--to-revisions <name>=100`) has the same effect. The pipeline uses
`--to-latest` so it does not leave the service in that state.

If the new revision never becomes Ready, or a newer revision appears
before the traffic update, the previous revision still has 100% and there
is nothing to switch.

When a Ready revision was given traffic and then misbehaves:

```bash
gcloud run revisions list --service <service> --region europe-west3 --project the-somnus
gcloud run services update-traffic <service> \
  --region europe-west3 --project the-somnus \
  --to-revisions <previous-revision>=100
```

That command pins traffic to the named revision. The next plain
`gcloud run deploy` will create a revision that receives no traffic
until someone runs:

```bash
gcloud run services update-traffic <service> \
  --region europe-west3 --project the-somnus \
  --to-latest
```

The Cloud Run module does not set a `traffic` block and does not ignore
`traffic`. An omitted block means 100% to the latest Ready revision. A
pipeline deploy that ends on `--to-latest` matches that, so the next
`terraform plan` should not show a traffic diff from the deploy. A
rollback that pins a named revision can: the plan will want to put
traffic back on the latest Ready revision. Do not apply that plan to
undo a rollback you still want.

Min-instances stays 0. Do not rebuild an image to roll back.
