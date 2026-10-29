# ADR 0023 — notes: context, detail, alternatives and citations

Companion to [ADR 0023](0023-nox-area.md). The ADR holds the decision; this file
holds its rationale. Where the two differ, the ADR wins. Decisions 6, 7 and 8
(population filtering, tables, doses) are complete in the ADR and are not
repeated here. Repository citations are to origin/main 911e48d.

## 1. Context

On 28/10/2026 the clinical lead confirmed the purpose of Nox: **diagnostic support
plus in-depth evidence search for physicians, paediatrics included**. The
assistant **gives doses**, adult and paediatric, always citing the exact guideline
with its link; the CFO reviews paediatric behaviour. With that purpose, and with
doses, Nox is very likely a **medical device (MDSW)**, possibly in a higher risk
class, and its AI likely high-risk under the EU AI Act.

- The report-service vector stores cannot hold a corpus of thousands of articles:
  vectors are JSON in `LONGTEXT`, every query loads the whole scope and ranks it
  in Python (Prompt 0 audit: ~2.3–3.4 GB read per query at 50,000 chunks × 3072
  dimensions, on a 512 MiB service).
- The SPAs reach `somnus-edge-api` through a Firebase Hosting rewrite of `/v1/**`
  on their own origin (ADR 0017). Hosting caps a rewritten request at 60 seconds;
  whether it buffers a streamed response is not documented.
- Identity has organisation invitations (the only door into a Nox organisation,
  Addendum A Checkpoint 14.2), professional verification and roles, but no Nox
  permission and no per-organisation Nox entitlement.
- Platform events are only logged today (`LoggingEventPublisher`; no Pub/Sub
  topic), and the BigQuery export is not configured in Terraform.
- A TiDB Cloud Starter instance that reaches its usage quota "immediately denies
  any new connection attempts"; customer-managed encryption keys are unavailable
  on Starter.

TiDB Cloud documentation read on 2026-10-28:
<https://docs.pingcap.com/ai/vector-search-index/>,
<https://docs.pingcap.com/tidbcloud/vector-search-limitations/>,
<https://docs.pingcap.com/tidbcloud/serverless-limitations/>,
<https://docs.pingcap.com/tidbcloud/manage-serverless-spend-limit/>,
<https://docs.pingcap.com/tidb/stable/encryption-at-rest/>,
<https://docs.pingcap.com/ai/vector-search-full-text-search-sql/>.

## 2. Detail of each decision

### 2.1 Deployables

A third SPA, `apps/somnus-nox`, on its own Hosting site at `nox.thesomnus.com`,
with the same stack, tokens and four locales as `somnus-app`. Two private Cloud
Run services, `nox-assistant-service` (agent, streaming, conversations) and
`nox-knowledge-service` (corpus, search, citation resolution, closed catalogues),
and one Cloud Run Job, `nox-ingest` (same image as knowledge). All Python 3.13,
FastAPI, uv, SQLAlchemy 2.0 sync + PyMySQL, Alembic (§3.5); minimum instances 0;
own service accounts and secrets. The assistant never touches the knowledge
database: it calls knowledge over internal HTTP with OIDC.

### 2.2 One public entry and access

`somnus-edge-api` gains a router `/nox/v1/*`, the only public way in (ADR 0008).
Nox access is an **explicit entitlement on the organisation, off by default**,
plus the **Nox permission**; every route checks with identity, on every request:
verified professional + active membership of an organisation with the
entitlement + the permission. Identity remains the only place that decides (§5.3).

### 2.3 Two modules in the panel

The clinical assistant and an evidence search, `GET /nox/v1/evidence/search`, both
served by the same search engine in `nox-knowledge-service`.

### 2.4 Two separate TiDB instances

The Nox data is separated for resilience (owner, 2026-10-29). `somnus_nox`
(conversations, feedback) lives on **its own new TiDB Cloud Starter instance**, and
`somnus_nox_knowledge` (documents, chunks, vectors, licences) on **another new
one**, both in AWS eu-central-1 (Frankfurt). The shared cluster of Morpheo,
identity, report and audit is untouched, so nothing in Nox can exhaust the quota
those services depend on. Each database has its own user; never a root user. Both
instances are **created by hand with a runbook**, and **not before this ADR is
approved and merged**; their credentials reach Terraform through secrets
referenced by data sources; the TiDB Cloud Terraform provider is deferred.

Dependencies: evidence search depends only on the knowledge instance; the
assistant depends on knowledge, conversations and the model provider.

**No confirmado**, to verify before creating them: the Starter limit of instances
per organisation, the spend limits, and the cost.

### 2.5 The knowledge store replaces, it does not extend

A native `VECTOR(n)` column with an HNSW index on cosine distance; `n` is a
setting (default 3072) that the column and the index follow. From report-service
Nox reuses the **patterns**, not its tables or its code: provider adapter, rights
gate before embedding, text-hash reuse, all-or-nothing writes, append-only
versions, a configuration-consistency test. Existing sources reach Nox by export,
never by reading report-service's databases (ADR 0003).

### 2.9 Citations are the system's

The model may cite only chunk ids returned in the same turn; a validator checks
each id and quoted text; the reference is rendered from metadata, never written
by the model.

### 2.10 Encryption and retention

The conversations instance holds **conversation text written by physicians**; the
knowledge instance holds public literature. Because customer-managed keys are not
available on Starter, conversation text is encrypted by the application with
per-organisation envelope encryption: one data key per organisation, wrapped by a Cloud KMS key in
`europe-west3`, unwrappable only by the assistant's service account.
Conversations are kept **30 days by default (DEFAULT – Jesús puede cambiarlo)**,
then deleted by a scheduled job; destroying an organisation's key makes all its
conversations unreadable, backups included (crypto-shredding). Literature keeps
the provider's encryption only (vector indexes are not supported on TiFlash with
encryption at rest).

### 2.11 Streaming

Streaming is a requirement (owner, 2026-10-29); polling is no longer a fallback.
The spike (Prompt 11, run separately) decides between:

- **Plan A:** a **resumable SSE stream through the Hosting rewrite**: each
  connection stays under 55 s and the browser reconnects with `Last-Event-ID`.
- **Plan B**, only if the spike shows that Hosting buffers the stream: a dedicated
  stream host on a custom domain of the same site, with a single-use, short-lived
  stream ticket issued by the same-origin API, so no cross-site cookies are needed.
  The session cookie is first-party only on the SPA's own origin, through the
  Hosting rewrite (ADR 0017, which supersedes ADR 0016); a dedicated stream host
  is cross-origin, so it cannot rely on that cookie, and that is why plan B uses a
  ticket and remains valid. It needs a custom domain mapping or a load balancer;
  their cost and region availability are **no confirmado**. For reference only,
  the superseded ADR 0016 recorded on 2026-10-05 a load balancer at ~18–20
  USD/month and Cloud Run domain mapping as unavailable in `europe-west3`.

A direct `*.run.app` URL with the session cookie is not an option: it makes the
cookie cross-site again (ADR 0017, which supersedes ADR 0016).

### 2.12 Events

`nox.session.started.v1`, `nox.turn.completed.v1`, `nox.instrument.suggested.v1`,
`nox.feedback.submitted.v1`, `nox.ingest.completed.v1`, `nox.error.v1`: no free
text, names or case content in any field.

Transport (owner, 2026-10-29, option C): Nox emits these events through the
existing `EventPublisher` port and its logging adapter, which logs the envelope
through the service's redaction pipeline
(`services/somnus-edge-api/src/infrastructure/events/logging-event-publisher.ts:5-13`).
The console Nox tab is built when Pub/Sub exists. That is production-readiness
gap #3, platform work that does not depend on Nox. This follows the reasoning of
the port (`services/somnus-edge-api/src/infrastructure/events/event-publisher.ts:6-16`):

> That module's ingest endpoint is documented as a **Pub/Sub push target**, and
> no Pub/Sub topic exists yet (production-readiness gap #3). Calling the worker
> over HTTP instead would invent a transport the build plan does not describe
> and add an edge -> worker dependency the deployable map does not have.

> the port fixes the event shape and the call sites now, and
> `LoggingEventPublisher` is swapped for a Pub/Sub adapter when gap #3 closes --
> with no controller, guard or interceptor changing.

Pub/Sub work that remains (production-readiness gap #3,
`docs/runbooks/production-readiness.md:52-58`): the Pub/Sub topics for domain
events are not declared in any environment (the module
`infrastructure/terraform/modules/pubsub-topic/` exists but nothing calls it), so
no push subscription reaches the worker's ingest route; the scoped service-account
grants the gap lists are not added; and the Pub/Sub adapter that replaces
`LoggingEventPublisher` is not written. The worker route exists and nothing calls
it today (`services/somnus-worker/src/modules/audit/audit.controller.ts:18-20`,
"Ingest an audit event (Pub/Sub push target)").

Python services (owner, 2026-10-29, option A): `nox-assistant-service`,
`nox-knowledge-service` and the Job `nox-ingest` each have their own event port
with a logging adapter that fulfils the same `EventEnvelope` contract, validated
against the JSON Schema generated from the Nox contracts.

Until Pub/Sub exists (gap #3), Nox events live only in the logs, so Nox is not
opened to real clinicians or real cases before there is a queryable audit trail.

### 2.13 AI

Models are configuration behind the provider layer; `store: false`;
pseudonymisation before any model call and before embedding any query. No real
patient case, even pseudonymised, until EU residency and a DPA with the provider,
a production environment separate from dev, an updated DPIA and a closed
regulatory assessment.

### 2.14 CI

An ephemeral TiDB container on loopback runs the knowledge service's vector SQL
(the `VECTOR` type and exact search) in the push path. HNSW is exercised only by
a manual `workflow_dispatch` job against a disposable Starter instance. The
destructive-setup rule of §3.9 holds: both targets die with the run; neither the
shared cluster nor the Nox instances are ever a test target.

### 2.15 Amendments

This ADR amends four statements and, through them, ADR 0010:

- `CLAUDE.md` lines 20–23, the same text as `AGENTS.md` lines 14–17: "Deployable
  map: 2 static frontends on Firebase Hosting (...) + 5 Cloud Run services (...).
  Never add or split deployables." becomes the five services plus the Nox
  deployables of this ADR (`apps/somnus-nox`, `nox-assistant-service`,
  `nox-knowledge-service`, the Job `nox-ingest`); any further deployable still
  needs its own ADR.
- `THE_SOMNUS_PLATFORM_BUILD_PLAN.md` §1, line 10: "**Out of scope:** Nox, Siren,
  ..." no longer lists Nox. §2, line 73: "Five Cloud Run services total." is read
  together with this ADR, which adds two Nox services and one Job.
- `THE_SOMNUS_PLATFORM_BUILD_PLAN.md` §3.9, line 190: "For the MVP, one physical
  cluster contains multiple logical databases" no longer holds: Nox uses two
  separate TiDB Starter instances.
- `CLAUDE.md` lines 24–25, the same text as `AGENTS.md` lines 18–19: "Minimum
  instances = 0 everywhere. Never add warm-up mechanisms beyond the ones
  pre-approved in build plan §2." admits, for Nox only, one non-blocking warm-up
  call per Nox login (`GET /nox/v1/me`), with no scheduled pings and no change to
  the minimum instances.

### 2.16 Resilience

- **Fault isolation** per service and per database (decision 4): a failure of
  one Nox service or instance does not take down the others or the platform.
- **Fail closed:** never answer without sources; never switch model provider
  automatically, because a second provider would need its own EU residency and
  DPA (decision 13).
- **Calls:** timeouts, bounded retries with backoff and jitter, circuit breakers,
  and per-physician and per-organisation limits.
- **Turns:** idempotent with an `Idempotency-Key`; turn state is persisted and the
  stream sends heartbeats, so a dropped stream resumes (decision 11).
- **Ingest:** idempotent and checkpointed; it switches the current corpus version
  atomically, only when the new version is complete and validated.
- **Warm-up:** `GET /nox/v1/me` makes one non-blocking warm-up call to the Nox
  services per Nox login; no scheduled pings; minimum instances unchanged. Build
  plan §2 (line 81) lets nothing else fight cold starts "without a new decision";
  this ADR is that decision for Nox, and the fourth amendment (section 2.15)
  carries it into `CLAUDE.md` and `AGENTS.md`.
- **Service-level objectives and alerts** for first-token latency, error rate,
  citation validation and quota use.

## 3. Accepted risk

With separate instances, an ingest can no longer deny connections to the
conversations database or to Morpheo. What remains: an ingest that exhausts the
knowledge instance's quota degrades search for that period. Mitigations:
throttled, bounded batches; `nox-ingest` scheduled outside clinic hours and
disabled by default; a spend limit with an email alert.

Until Pub/Sub exists (gap #3), Nox events live only in the logs, so Nox is not
opened to real clinicians or real cases before there is a queryable audit trail
(section 2.12).

## 4. Open questions

### 4.1 Nox access details

The specialties allowed and whether a second factor is required.

### 4.2 Vector index maturity

Public preview on Starter; availability in eu-central-1 and the maximum
indexable dimension are not stated in the docs.

### 4.3 Regulatory classification and intended-use wording

Clinical lead and legal counsel.

### 4.4 Minimum instances of the Nox services in production

0 (cost) or 1 (latency), decided after the spike measures the cold starts of
Cloud Run and of Starter. Choosing 1 would also need an amendment: build plan §2
(line 79) sets minimum instances 0 "in every environment, including production",
and `CLAUDE.md` line 24 repeats it.

## 5. Alternatives considered

- **Extend report-service's tables** — JSON vectors, ranking in Python, and the
  patient report's service coupled to a professional product. Rejected.
- **An isolated module inside an existing service (ADR 0010 style)** — the report
  service sits on the patient path; Nox needs its own IAM (KMS), scaling and
  release cycle. Rejected.
- **One `nox-service`** — an agent and a corpus scale, fail and hold secrets
  differently; ingest is batch. Rejected.
- **Nox databases in the shared cluster** — one quota for everything. Rejected
  (decision 4).
- **One Nox instance for both databases** (the draft of 2026-10-28) — an ingest
  could deny connections to the conversations. Rejected for resilience (owner,
  2026-10-29).
- **Short polling as the streaming fallback** — streaming is a requirement.
  Rejected (owner, 2026-10-29).
- **An automatic switch to a second model provider** — it would need its own EU
  residency and DPA. Rejected (section 2.16).
- **Events by authenticated HTTP to the worker** (option A) — edge-api and the
  assistant would send `nox.*` events by OIDC to
  `services/somnus-worker/src/modules/audit/audit.controller.ts:18-20` and the
  console would read them from `somnus_audit`; it adds the edge -> worker
  transport the port rejects (section 2.12). Not chosen (owner, 2026-10-29).
- **Pub/Sub for events now** (option B) — needs gap #3 closed first, platform work
  that does not depend on Nox. Not chosen now; the port takes a Pub/Sub adapter
  when gap #3 closes (section 2.12).
- **The TiDB Cloud Terraform provider now** — a new provider; deferred.
- **A separate vector database** — §3.6b and a new dependency. Rejected.
- **A post-filter for population** — can starve paediatric results. Rejected.
- **`app.thesomnus.com/nox`** — shared attack surface and release cycle with
  patients. Rejected.
- **1024 dimensions now** — deferred to the retrieval benchmark on the clinical
  lead's cases.

## 6. Consequences in full

- The map grows from three Hosting sites and five Cloud Run services to four
  sites, seven services and one Cloud Run Job, each independently buildable and
  deployable; and from one TiDB cluster to three.
- Report-service and Morpheo do not change.
- The deployable rule now lives in this ADR: adding anything else still needs
  its own ADR.
