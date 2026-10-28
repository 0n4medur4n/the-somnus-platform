# ADR 0023 — Nox: a professionals-only area with its own SPA, services and knowledge database

- Status: Proposed (records the owner's decisions of 2026-10-28; awaits the owner's approval)
- Date: 2026-10-28
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
  permission and no per-organisation "Nox enabled" flag.
- Platform events are only logged today (`LoggingEventPublisher`; no Pub/Sub
  topic), and the BigQuery export is not configured in Terraform.

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
2. **One public entry.** `somnus-edge-api` gains a router `/nox/v1/*`, the only
   public way in (ADR 0008). Every route checks with identity, on every request:
   verified professional + active membership of an organisation with Nox + the
   Nox permission. Identity remains the only place that decides (§5.3).
3. **Databases.** `somnus_nox` (conversations, feedback; text fields encrypted
   by the application) and `somnus_nox_knowledge` (documents, chunks, vectors,
   licences). **`somnus_nox_knowledge` lives on a separate TiDB Cloud Starter
   instance in AWS eu-central-1 (Frankfurt)**: a Starter instance that reaches its
   quota denies new connections, so an ingest must never share a quota with
   Morpheo and identity. Each database has its own user; never the cluster root.
4. **The knowledge store replaces, it does not extend.** A native `VECTOR(n)`
   column with an HNSW index on cosine distance; `n` is a setting (default 3072)
   that the column and the index follow. From report-service Nox reuses the
   **patterns**, not its tables or its code: provider adapter, rights gate before
   embedding, text-hash reuse, all-or-nothing writes, append-only versions, a
   configuration-consistency test. Existing sources reach Nox by export, never by
   reading report-service's databases (ADR 0003).
5. **Population filtering is structural.** Adult and paediatric chunks live in
   separate vector tables, each with its own HNSW index; a chunk marked for both
   populations is written to both. Alternatively, a population with a small
   enough subset uses exact search (pre-filter, no index). Never a post-filter
   over approximate results, which can return fewer rows or none, and **never a
   fallback from paediatric to adult sources**: an empty result is shown as "no
   source in the corpus". Non-safety filters (year, study type, evidence level)
   may narrow results but never widen them, and the UI says when fewer are shown.
6. **Dose policy** (decided by the clinical lead; details DEFAULT – Jesús puede
   cambiarlo). A dose is shown only when it appears verbatim in a cited chunk,
   that chunk's population matches the patient's, and the guideline's
   `rights_status` allows using its text; with title, year, section or page and
   link. Per-kg doses are computed by code from the weight the clinician
   confirms, showing the formula and any stated maximum; the model never does the
   arithmetic. Without usable guideline text: reference and link, no dose.
7. **Citations are the system's.** The model may cite only chunk ids returned in
   the same turn; a validator checks each id and quoted text; the reference is
   rendered from metadata, never written by the model.
8. **Encryption.** Envelope encryption per organisation with Cloud KMS in
   `europe-west3`; only the assistant's service account can unwrap. The knowledge
   instance holds no patient data and keeps the provider's encryption
   (customer-managed keys are not available on Starter; vector indexes are not
   supported on TiFlash with encryption at rest).
9. **Events.** `nox.session.started.v1`, `nox.turn.completed.v1`,
   `nox.instrument.suggested.v1`, `nox.feedback.submitted.v1`,
   `nox.ingest.completed.v1`, `nox.error.v1`: no free text, names or case
   content in any field, through the existing `EventPublisher` port.
10. **AI.** Models are configuration behind the provider layer; `store: false`;
    pseudonymisation before any model call and before embedding any query. No
    real patient case, even pseudonymised, until EU residency and a DPA with the
    provider, a production environment separate from dev, an updated DPIA and a
    closed regulatory assessment.
11. **CI.** An ephemeral TiDB container on loopback runs the knowledge service's
    vector SQL (the `VECTOR` type and exact search) in the push path. HNSW is
    exercised only by a manual `workflow_dispatch` job against a disposable
    Starter instance. The destructive-setup rule of §3.9 holds: both targets die
    with the run; the shared cluster is never a test target.
12. **Amendments.** This ADR amends two statements and, through them, ADR 0010:
    - `CLAUDE.md` (lines 20–23; the same text in `AGENTS.md` lines 14–17):
      "...+ 5 Cloud Run services (...). Never add or split deployables." becomes
      the five services plus the Nox deployables of this ADR; any further
      deployable still needs its own ADR.
    - Build plan §1 (line 10): "**Out of scope:** Nox, Siren, ..." no longer lists
      Nox; §2 (line 73) "Five Cloud Run services total." is read with this ADR.
    The edits to those files are a separate change outside `docs/adr/`.

## Alternatives considered

- **Extend report-service's tables** — JSON vectors, ranking in Python, and the
  patient report's service coupled to a professional product. Rejected.
- **An isolated module inside an existing service (ADR 0010 style)** — the report
  service sits on the patient path; Nox needs its own IAM (KMS), scaling and
  release cycle. Rejected.
- **One `nox-service`** — an agent and a corpus scale, fail and hold secrets
  differently; ingest is batch. Rejected.
- **Knowledge database in the shared cluster** — one quota for everything.
  Rejected (decision 3).
- **A separate vector database** — §3.6b and a new dependency. Rejected.
- **A post-filter for population** — can starve paediatric results. Rejected.
- **`app.thesomnus.com/nox`** — shared attack surface and release cycle with
  patients. Rejected.
- **1024 dimensions now** — deferred to the retrieval benchmark on the clinical
  lead's cases.

## Open questions

1. **Streaming path.** Hosting's 60-second cap applies to the `/v1/**`-style
   rewrite, and buffering is undocumented. Options: verify unbuffered streaming
   and keep turns under 60 s; a load balancer (~18–20 USD/month, rejected for cost
   in ADR 0016); or short polling instead of SSE. A direct `*.run.app` URL makes
   the cookie cross-site again (ADR 0016). Spike before Phase 3.
2. **Event transport.** Events are only logged and BigQuery is not configured;
   the console's Nox tab needs Pub/Sub (production-readiness gap #3) first.
3. **Nox permission model** in identity: an organisation-level flag, the
   specialties allowed, and whether a second factor is required.
4. **Where `somnus_nox` lives**: the shared cluster with its own user, or the new
   instance.
5. **The TiDB instance in Terraform**: the TiDB Cloud provider (a new provider)
   or created by hand and referenced by data sources.
6. **Vector index maturity**: public preview on Starter; availability in
   eu-central-1 and the maximum indexable dimension are not stated in the docs.
7. **Regulatory classification and intended-use wording**: clinical lead and
   legal counsel.

## Consequences

- The map grows from three Hosting sites and five Cloud Run services to four
  sites, seven services and one Cloud Run Job, each independently buildable and
  deployable.
- Report-service and Morpheo do not change.
- The deployable rule now lives in this ADR: adding anything else still needs
  its own ADR.
