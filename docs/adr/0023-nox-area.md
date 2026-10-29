# ADR 0023 — Nox: a professionals-only area with its own SPA, services and TiDB instance

- Status: Proposed (records the owner's decisions of 2026-10-28 and the owner's review of 2026-10-29; awaits the owner's approval)
- Date: 2026-10-29
- Decides: §1 (scope), §2 (deployable map), §3.6b, §3.9; amends ADR 0010; refines ADR 0003, 0008, 0017; §14b and §15 unchanged for Morpheo

## Context

Nox is the space of The Somnus for verified professionals. On 28/10/2026 the
clinical lead confirmed its purpose: **diagnostic support plus in-depth evidence
search for physicians, paediatrics included**. The assistant **gives doses**,
adult and paediatric, always citing the exact guideline with its link; the CFO
reviews paediatric behaviour. With that purpose, and with doses, Nox is very
likely a **medical device (MDSW)**, possibly in a higher risk class, and its AI
likely high-risk under the EU AI Act. The regulatory analysis belongs to the
clinical lead and legal counsel, not to this ADR.

Facts this decision rests on (origin/main 911e48d):

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
  on Starter (TiDB Cloud docs, read 2026-10-28).

## Decision

1. **Deployables.** A third SPA, `apps/somnus-nox`, on its own Hosting site at
   `nox.thesomnus.com`, with the same stack, tokens and four locales as
   `somnus-app`. Two private Cloud Run services, `nox-assistant-service` (agent,
   streaming, conversations) and `nox-knowledge-service` (corpus, search,
   citation resolution, closed catalogues), and one Cloud Run Job, `nox-ingest`
   (same image as knowledge). All Python 3.13, FastAPI, uv, SQLAlchemy 2.0 sync +
   PyMySQL, Alembic (§3.5); minimum instances 0; own service accounts and secrets.
   The assistant never touches the knowledge database: it calls knowledge over
   internal HTTP with OIDC.
2. **One public entry and access.** `somnus-edge-api` gains a router `/nox/v1/*`,
   the only public way in (ADR 0008). Nox access is an **explicit entitlement on
   the organisation, off by default**, plus the **Nox permission**; every route
   checks with identity, on every request: verified professional + active
   membership of an organisation with the entitlement + the permission. Identity
   remains the only place that decides (§5.3).
3. **Two modules in the panel.** The clinical assistant and an evidence search,
   `GET /nox/v1/evidence/search`, both served by the same search engine in
   `nox-knowledge-service`.
4. **A separate TiDB instance.** `somnus_nox` (conversations, feedback) **and**
   `somnus_nox_knowledge` (documents, chunks, vectors, licences) both live on a
   **new TiDB Cloud Starter instance in AWS eu-central-1 (Frankfurt)**, not in the
   shared cluster, so nothing in Nox can exhaust the quota that Morpheo and
   identity depend on. Each database has its own user; never a root user. The
   instance is **created by hand with a runbook** and its credentials reach
   Terraform through secrets referenced by data sources; the TiDB Cloud Terraform
   provider is deferred.
5. **The knowledge store replaces, it does not extend.** A native `VECTOR(n)`
   column with an HNSW index on cosine distance; `n` is a setting (default 3072)
   that the column and the index follow. From report-service Nox reuses the
   **patterns**, not its tables or its code: provider adapter, rights gate before
   embedding, text-hash reuse, all-or-nothing writes, append-only versions, a
   configuration-consistency test. Existing sources reach Nox by export, never by
   reading report-service's databases (ADR 0003).
6. **Population filtering is structural.** Adult and paediatric chunks live in
   separate vector tables, each with its own HNSW index; a chunk marked for both
   populations is written to both. Alternatively, a population with a small
   enough subset uses exact search (pre-filter, no index). Never a post-filter
   over approximate results, which can return fewer rows or none, and **never a
   fallback from paediatric to adult sources**: an empty result is shown as "no
   source in the corpus". Non-safety filters (year, study type, evidence level)
   may narrow results but never widen them, and the UI says when fewer are shown.
7. **Tables.** The corpus is stored as Markdown. A table is never split across
   chunks and keeps its caption, header row and footnotes. Automatic checks set
   `table_quality` from consistent columns, complete headers, units present and
   numeric cells that parse. Tables and doses pass through the system, not the
   model: the model emits a chunk reference and the system inserts the stored
   Markdown verbatim.
8. **Dose policy** (decided by the clinical lead; details DEFAULT – Jesús puede
   cambiarlo). A dose is shown only when it appears verbatim in a cited chunk,
   that chunk's population matches the patient's, the guideline's `rights_status`
   allows using its text, and, when it comes from a table, the table's
   `table_quality` is not low; always with title, year, section or page and link.
   A low-quality table cannot supply a dose and is shown only as a link to the
   source page. Per-kg doses are computed by code from the weight the clinician
   confirms, showing the formula and any stated maximum; the model never does the
   arithmetic. Without usable guideline text: reference and link, no dose. The
   reviewers (the clinical lead and the CFO) check a golden set of dose tables
   against the source page once, on the first guideline set.
9. **Citations are the system's.** The model may cite only chunk ids returned in
   the same turn; a validator checks each id and quoted text; the reference is
   rendered from metadata, never written by the model.
10. **Encryption and retention.** The Nox instance holds public literature **and
    conversation text written by physicians**. Because customer-managed keys are
    not available on Starter, conversation text is encrypted by the application
    with per-organisation envelope encryption: one data key per organisation,
    wrapped by a Cloud KMS key in `europe-west3`, unwrappable only by the
    assistant's service account. Conversations are kept **30 days by default
    (DEFAULT – Jesús puede cambiarlo)**, then deleted by a scheduled job;
    destroying an organisation's key makes all its conversations unreadable,
    backups included (crypto-shredding). Literature keeps the provider's
    encryption only (vector indexes are not supported on TiFlash with
    encryption at rest).
11. **Streaming.** A spike comes first. If SSE passes through Hosting unbuffered,
    the target design is a **resumable stream**: each connection stays under
    55 s and the browser reconnects with `Last-Event-ID`. Short polling is the
    fallback; a load balancer (~18–20 USD/month, rejected for cost in ADR 0016)
    is the last resort. A direct `*.run.app` URL is not an option: it makes the
    cookie cross-site again (ADR 0016).
12. **Events.** `nox.session.started.v1`, `nox.turn.completed.v1`,
    `nox.instrument.suggested.v1`, `nox.feedback.submitted.v1`,
    `nox.ingest.completed.v1`, `nox.error.v1`: no free text, names or case
    content in any field. Their transport is open (question 1).
13. **AI.** Models are configuration behind the provider layer; `store: false`;
    pseudonymisation before any model call and before embedding any query. No
    real patient case, even pseudonymised, until EU residency and a DPA with the
    provider, a production environment separate from dev, an updated DPIA and a
    closed regulatory assessment.
14. **CI.** An ephemeral TiDB container on loopback runs the knowledge service's
    vector SQL (the `VECTOR` type and exact search) in the push path. HNSW is
    exercised only by a manual `workflow_dispatch` job against a disposable
    Starter instance. The destructive-setup rule of §3.9 holds: both targets die
    with the run; neither the shared cluster nor the Nox instance is ever a test
    target.
15. **Amendments.** This ADR amends two statements and, through them, ADR 0010:
    - `CLAUDE.md` (lines 20–23; the same text in `AGENTS.md` lines 14–17):
      "...+ 5 Cloud Run services (...). Never add or split deployables." becomes
      the five services plus the Nox deployables of this ADR; any further
      deployable still needs its own ADR.
    - Build plan §1 (line 10): "**Out of scope:** Nox, Siren, ..." no longer lists
      Nox; §2 (line 73) "Five Cloud Run services total." is read with this ADR.
    The edits to those files are a separate change outside `docs/adr/`.

## Accepted risk

An ingest can exhaust the Nox instance's quota and deny new connections to the
assistant too. Mitigations: throttled, bounded batches; `nox-ingest` scheduled
outside clinic hours and disabled by default; a spend limit with an email alert;
revisit a separate instance for conversations if the load grows.

## Alternatives considered

- **Extend report-service's tables** — JSON vectors, ranking in Python, and the
  patient report's service coupled to a professional product. Rejected.
- **An isolated module inside an existing service (ADR 0010 style)** — the report
  service sits on the patient path; Nox needs its own IAM (KMS), scaling and
  release cycle. Rejected.
- **One `nox-service`** — an agent and a corpus scale, fail and hold secrets
  differently; ingest is batch. Rejected.
- **Nox databases in the shared cluster** — one quota for everything. Rejected
  (decision 4).
- **A third instance for conversations now** — kept as the escalation of the
  accepted risk.
- **The TiDB Cloud Terraform provider now** — a new provider; deferred.
- **A separate vector database** — §3.6b and a new dependency. Rejected.
- **A post-filter for population** — can starve paediatric results. Rejected.
- **`app.thesomnus.com/nox`** — shared attack surface and release cycle with
  patients. Rejected.
- **1024 dimensions now** — deferred to the retrieval benchmark on the clinical
  lead's cases.

## Open questions

1. **Event transport (not decided by the owner).** Options: (a) Pub/Sub
   (production-readiness gap #3), as the `EventPublisher` port anticipates
   (`services/somnus-edge-api/src/infrastructure/events/event-publisher.ts:6-16`);
   (b) **recommended by the owner:** edge-api and the assistant send `nox.*`
   events by authenticated HTTP (OIDC) to the worker's existing ingestion route
   (`services/somnus-worker/src/modules/audit/audit.controller.ts:18-20`, which
   nothing calls today), and the console reads them from `somnus_audit`, with no
   Pub/Sub. The port's header argues against an edge→worker HTTP call; choosing
   (b) supersedes that reasoning.
2. **Nox access details**: the specialties allowed and whether a second factor is
   required.
3. **Vector index maturity**: public preview on Starter; availability in
   eu-central-1 and the maximum indexable dimension are not stated in the docs.
4. **Regulatory classification and intended-use wording**: clinical lead and
   legal counsel.

## Consequences

- The map grows from three Hosting sites and five Cloud Run services to four
  sites, seven services and one Cloud Run Job, each independently buildable and
  deployable; and from one TiDB cluster to two.
- Report-service and Morpheo do not change.
- The deployable rule now lives in this ADR: adding anything else still needs
  its own ADR.
