# ADR 0023 — Nox: a professionals-only area with its own SPA, services and TiDB instances

- Status: Accepted (2026-10-29), with the owner's approval of the decisions of 2026-10-28 and 2026-10-29; the open questions remain open
- Date: 2026-10-29
- Decides: §1 (scope), §2 (deployable map), §3.6b, §3.9; amends ADR 0010; refines ADR 0003, 0008, 0017; §14b and §15 unchanged for Morpheo
- Context, detail, alternatives and citations: [`0023-nox-area-notes.md`](0023-nox-area-notes.md), cited as "notes N"

## Decision

1. **Deployables.** SPA `apps/somnus-nox`; private services `nox-assistant-service` and
   `nox-knowledge-service`; Cloud Run Job `nox-ingest` (notes 2.1).
2. **Access.** Verified professional, active member of an organisation with the Nox
   entitlement on (default off), Nox permission; identity checks every `/nox/v1/*` request.
3. **Modules.** The assistant and `GET /nox/v1/evidence/search`, one engine (notes 2.3).
4. **Instances.** `somnus_nox` and `somnus_nox_knowledge` on one new TiDB Starter instance
   each (eu-central-1), created by hand only after this ADR is merged (notes 2.4).
5. **Store.** Native `VECTOR(n)` + HNSW for Nox; report and Morpheo stores unchanged (notes 2.5).
6. **Population filtering is structural.** Adult and paediatric chunks live in separate vector
   tables, each with its own HNSW index; a chunk marked for both populations is written to
   both. Alternatively, a population with a small enough subset uses exact search (pre-filter,
   no index). Never a post-filter over approximate results, which can return fewer rows or
   none, and **never a fallback from paediatric to adult sources**: an empty result is shown
   as "no source in the corpus". Non-safety filters (year, study type, evidence level) may
   narrow results but never widen them, and the UI says when fewer are shown.
7. **Tables.** The corpus is stored as Markdown. A table is never split across chunks and
   keeps its caption, header row and footnotes. Automatic checks set `table_quality` from
   consistent columns, complete headers, units present and numeric cells that parse. Tables
   and doses pass through the system, not the model: the model emits a chunk reference and the
   system inserts the stored Markdown verbatim.
8. **Dose policy** (decided by the clinical lead; details DEFAULT – Jesús puede cambiarlo). A
   dose is shown only when it appears verbatim in a cited chunk, that chunk's population
   matches the patient's, the guideline's `rights_status` allows using its text, and, when it
   comes from a table, the table's `table_quality` is not low; always with title, year,
   section or page and link. A low-quality table cannot supply a dose and is shown only as a
   link to the source page. A dose that comes from prose is inserted as a verbatim quoted span
   of the chunk, with its offsets, exactly like a table. Per-kg doses are computed by code
   from the weight the clinician confirms, showing the formula and any stated maximum; the
   model never does the arithmetic. Without usable guideline text: reference and link, no
   dose. The reviewers (the clinical lead and the CFO) check a golden set of dose tables
   against the source page once, on the first guideline set. Those tables become golden
   fixtures: any change to the converter or its version re-runs them automatically and fails
   if the output differs.
9. **Citations.** Validated chunk ids of the same turn, rendered by the system (notes 2.9).
10. **Encryption.** No customer-managed keys on Starter: the application encrypts conversation
    text with per-organisation envelope keys wrapped by Cloud KMS (`europe-west3`); 30 days
    (DEFAULT – Jesús puede cambiarlo); destroying an organisation key crypto-shreds them.
11. **Streaming, no polling.** A: resumable SSE via the Hosting rewrite. B: a same-site stream
    host with a single-use ticket, a second public endpoint needing its own ADR 0008
    exception, decided only if the spike shows that A fails (notes 2.11).
12. **Events.** Six `nox.*` events, no free text, via a logging `EventPublisher` port in each
    service; the console Nox tab waits for Pub/Sub (notes 2.12).
13. **AI.** Provider layer, `store: false`, pseudonymised. Likely a medical device (MDSW): no
    real case before a closed regulatory assessment, EU residency and a DPA with the model
    provider, production apart from dev, an updated DPIA, a queryable audit trail.
14. **CI.** Loopback TiDB on push; HNSW only on a disposable instance (notes 2.14).
15. **Amendments** (separate change; notes 2.15): `CLAUDE.md` 20–25 and `AGENTS.md` 14–19
    (deployables; one non-blocking warm-up per Nox login, no pings, same minimum instances);
    build plan §1 line 10, §2 line 73, §3.9 line 190 ("one physical cluster").
16. **Resilience.** Isolation per service and database; fail closed (no answer without
    sources, no automatic provider switch); timeouts, bounded retries, circuit breakers,
    limits; resumable idempotent turns; atomic corpus versions; SLOs, alerts (notes 2.16).

## Accepted risk

An ingest that exhausts the knowledge quota degrades search for that period only; mitigated by
bounded, off-hours ingest and a spend limit with an alert (notes 3).

## Open questions

1. Specialties and second factor. 2. Vector-index maturity. 3. Regulatory class.
4. Minimum instances of the Nox services in production, 0 or 1, after the spike (notes 4).

## Consequences

Four sites, seven Cloud Run services, one Job, three TiDB clusters; report and Morpheo unchanged.
