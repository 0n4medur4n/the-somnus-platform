# ADR 0001 — One Cloud Run service per bounded context

- Status: Accepted
- Date: 2026-07-21
- Phase: 1.2
- Decides: §2 (Deployable map), §5 (Service responsibilities)

## Context

The Somnus has five business contexts with clearly different data,
security and scaling profiles: edge API / BFF, identity + consent,
Morpheo assessment, report rendering, and the worker. Sharing an
infrastructure unit between any of them couples deployment, IAM,
retention, and blast radius.

## Decision

Each bounded context runs as its own Cloud Run service with its own
Docker image, its own service account, its own environment variables
and secrets, its own database credentials and migrations, and its own
health checks and deploy lifecycle. `min-instances = 0` everywhere.
Region: `europe-west3`.

## Consequences

- Independent deploys and rollbacks; no monolith.
- One service account per service enforces least-privilege IAM (§21).
- Cost is bounded because every service idles to zero.
- Operational overhead scales with the number of services — accepted.
- Cold starts accepted as the cost of runway (§2).
