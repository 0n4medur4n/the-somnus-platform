# Runbook: move dev Terraform state to GCS (one time)

Dev state was a local file (`infrastructure/terraform/environments/dev/terraform.tfstate`)
on the operator's laptop: no versions, no lock, gone with the disk. From the
commit that adds this runbook, `environments/dev/versions.tf` declares a `gcs`
backend, like staging and production. Until the steps below are run, any
`terraform plan` in dev stops with "Backend initialization required".

Run every command from a checkout **that contains that commit**, in the same
folder that holds the current `terraform.tfstate` (the main working tree).
Nobody else may run Terraform in dev while you do this.

## 0. Back up the current state

```bash
cd infrastructure/terraform/environments/dev
cp terraform.tfstate "terraform.tfstate.pre-gcs-$(date +%Y%m%d%H%M%S).backup"
# How many resources the local state holds (Terraform itself cannot read it
# until step 2, because versions.tf already names the new backend):
python -c "import json;d=json.load(open('terraform.tfstate'));print(d['serial'],len(d['resources']))"
```

Write both numbers down (serial, resource count).

## 1. Create the bucket (once, outside Terraform)

The bucket holds the state that would create it, so Terraform cannot own it.

```bash
gcloud storage buckets create gs://the-somnus-tfstate-dev \
  --project=the-somnus \
  --location=europe-west3 \
  --uniform-bucket-level-access \
  --public-access-prevention
gcloud storage buckets update gs://the-somnus-tfstate-dev --versioning
gcloud storage buckets describe gs://the-somnus-tfstate-dev \
  --format="value(location,versioning_enabled,public_access_prevention,uniform_bucket_level_access)"
# expect: EUROPE-WEST3  True  enforced  True
```

If the name is taken (bucket names are global), pick another and use it in
step 2.

Access: the bucket inherits project IAM (owners/editors of `the-somnus`). No
public or service-account grant is needed for an operator applying by hand.

## 2. Point Terraform at it

```bash
cp backend.hcl.example backend.hcl     # gitignored; edit the bucket if you changed it
terraform init -migrate-state -backend-config=backend.hcl
```

Terraform asks: *"Do you want to copy existing state to the new backend?"* —
answer **yes**.

## 3. Verify

```bash
gcloud storage ls gs://the-somnus-tfstate-dev/terraform/state/dev/
# expect: .../default.tfstate
terraform state pull | python -c "import json,sys;d=json.load(sys.stdin);print(d['serial'],len(d['resources']))"
terraform plan
```

The resource count must equal the one from step 0 (the serial may go up by
one). `terraform plan` must show only changes you expect
(for example the alert channel and the retention job from the quick fixes), and
**no resource to destroy or replace** because of the move.

## 4. Afterwards

- Keep the `.backup` file from step 0 until a plan against the bucket has been
  clean once, then move it out of the repository folder. State can hold
  resource details; do not share it.
- The old `terraform.tfstate` is no longer read. Rename it
  (`terraform.tfstate.local-retired`) so nobody edits it by mistake.
- Locking is automatic on the GCS backend: a second `apply` waits or fails
  instead of corrupting state.

## Roll back (if step 3 is not clean)

```bash
rm -rf .terraform
git checkout <previous commit> -- versions.tf   # back to backend "local"
cp terraform.tfstate.pre-gcs-*.backup terraform.tfstate
terraform init -reconfigure
terraform plan
```
