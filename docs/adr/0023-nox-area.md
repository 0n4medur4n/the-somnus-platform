# ADR 0023 — Nox: a professionals-only area with its own SPA, services and TiDB instances

- Status: Proposed (owner's decisions of 2026-10-28 and 2026-10-29; awaits the owner's approval)
- Date: 2026-10-29
- Decides: §1 (scope), §2 (deployable map), §3.6b, §3.9; amends ADR 0010; refines ADR 0003, 0008, 0017; §14b and §15 unchanged for Morpheo
- Context, detail, alternatives and citations: [`0023-nox-area-notes.md`](0023-nox-area-notes.md), cited as "notes N"

## Decision

1. **Deployables.** SPA `apps/somnus-nox`; private services `nox-assistant-service`
   and `nox-knowledge-service`; Cloud Run Job `nox-ingest` (notes 2.1).
2. **Access.** Only via edge-api `/nox/v1/*`: organisation entitlement (off by
   default) + Nox permission, checked with identity on every request (notes 2.2).
3. **Modules.** The assistant and `GET /nox/v1/evidence/search`, one engine (notes 2.3).
4. **Instances.** `somnus_nox` and `somnus_nox_knowledge` each on its own new TiDB
   Starter instance (eu-central-1), created by hand only after this ADR is approved
   and merged; the shared cluster is untouched (notes 2.4).
5. **Store.** Native `VECTOR(n)` + HNSW replaces report-service's stores (notes 2.5).
6. **Population filtering is structural.** Adult and paediatric chunks live in separate
   vector tables, each with its own HNSW index; a chunk marked for both populations is
   written to both. Alternatively, a population with a small enough subset uses exact
   search (pre-filter, no index). Never a post-filter over approximate results, which
   can return fewer rows or none, and **never a fallback from paediatric to adult
   sources**: an empty result is shown as "no source in the corpus". Non-safety filters
   (year, study type, evidence level) may narrow results but never widen them, and the
   UI says when fewer are shown.
7. **Tables.** The corpus is stored as Markdown. A table is never split across chunks
   and keeps its caption, header row and footnotes. Automatic checks set `table_quality`
   from consistent columns, complete headers, units present and numeric cells that
   parse. Tables and doses pass through the system, not the model: the model emits a
   chunk reference and the system inserts the stored Markdown verbatim.
8. **Dose policy** (decided by the clinical lead; details DEFAULT – Jesús puede
   cambiarlo). A dose is shown only when it appears verbatim in a cited chunk, that
   chunk's population matches the patient's, the guideline's `rights_status` allows
   using its text, and, when it comes from a table, the table's `table_quality` is not
   low; always with title, year, section or page and link. A low-quality table cannot
   supply a dose and is shown only as a link to the source page. A dose that comes from
   prose is inserted as a verbatim quoted span of the chunk, with its offsets, exactly
   like a table. Per-kg doses are computed by code from the weight the clinician
   confirms, showing the formula and any stated maximum; the model never does the
   arithmetic. Without usable guideline text: reference and link, no dose. The
   reviewers (the clinical lead and the CFO) check a golden set of dose tables against
   the source page once, on the first guideline set. Those tables become golden
   fixtures: any change to the converter or its version re-runs them automatically and
   fails if the output differs.
9. **Citations.** Validated chunk ids of the same turn, rendered by the system (notes 2.9).
10. **Encryption.** Per-organisation KMS keys; 30 days (DEFAULT – Jesús puede cambiarlo) (notes 2.10).
11. **Streaming is a requirement; no polling.** A: resumable SSE via the Hosting rewrite;
    B, only if it buffers: a same-site stream host with a single-use ticket (notes 2.11).
12. **Events** (owner, 2026-10-29). Six `nox.*` events with no free text, emitted through
    the existing `EventPublisher` port and its logging adapter; the console Nox tab
    is built when Pub/Sub exists (production-readiness gap #3) (notes 2.12).
13. **AI.** Provider layer, `store: false`, pseudonymised; no real case yet (notes 2.13).
14. **CI.** Loopback TiDB on push; HNSW only on a disposable instance (notes 2.14).
15. **Amendments** (a separate change; notes 2.15): `CLAUDE.md` 20–23, `AGENTS.md` 14–17,
    build plan §1 line 10, §2 line 73; and §3.9 line 190, "For the MVP, one physical
    cluster contains multiple logical databases", no longer holds (two Nox instances).
16. **Resilience.** Fault isolation per service and per database; fail closed (no
    answer without sources, no automatic provider switch); timeouts, bounded retries,
    circuit breakers and limits; resumable idempotent turns; atomic corpus versions; a
    warm-up on `GET /nox/v1/me`; SLOs and alerts (notes 2.16).

## Accepted risk

An ingest that exhausts the knowledge instance's quota degrades search for that period
only; mitigated by bounded, off-hours ingest and a spend limit with an alert (notes 3).

## Open questions

1. Specialties and second factor. 2. Vector-index maturity. 3. Regulatory class.
4. Minimum instances of the Nox services in production, 0 or 1, after the spike (notes 4).

## Consequences

Four sites, seven Cloud Run services, one Job, three TiDB clusters; report and Morpheo unchanged.
