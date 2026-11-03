# ADR 0024 — A case record for every Morpheo interview

- Status: Accepted (owner decision, 2026-11-03)
- Date: 2026-11-03
- Amends: ADR 0021 (no health answers in the admin detail), Addendum A §A2.2–§A2.4
- Decides: §14 (Morpheo records), §13 (retention)

## Context

The owner needs to know what Morpheo is doing — how many interviews, how many
end in insomnia, restless legs and the other outcomes — and to be able to show,
if a family or a court ever asks, exactly what a person was asked, what they
answered and what they were shown. The console statistics count events, and
Morpheo v2 emits none, so they read zero. And the record itself did not survive:
anonymous interviews are deleted after 30 days, all of a person's on account
deletion, answers taken back were deleted, and the result was recomputed with
the current rules instead of kept as it was shown.

## Decision

1. **Every interview has a case** in `somnus_morpheo`, opened with it, under a
   random code (`SOM-XXXX-XXXX`, Crockford base32, 40 bits) never derived from
   anything about the person. The person sees the code with their result and in
   the PDF footer, so they or their family can quote it.
2. **Each closure is frozen** (`funnel_case_records`, append-only): the questions
   as worded, the answers as labelled, the result exactly as serialised to the
   person, and the content and rules versions. Answers taken back (back, Z1) are
   recorded as they read (`funnel_case_changes`). An interview closed before this
   decision gets a record rebuilt from its stored answers, marked `reconstructed`.
3. **The case outlives the interview.** Deleting the interview (30-day TTL, account
   erasure) only clears the case's `session_id`, its one link to a person. A case
   stores no owner id, name, address or account.
4. **Retention is a legal period, set by the owner** with legal advice:
   `POST /internal/v1/maintenance/funnel-cases/delete` deletes cases started
   before a cutoff the caller computes. Until the period is set, nothing calls it
   and cases are kept. The privacy text and the DPIA must say this before real
   patients are invited.
5. **Statistics** are counts over the cases (started, by status, by main action, by
   template, by alert, by month), served by morpheo and shown under
   `admin_statistics_read`. They carry no code, session or answer; the contract
   is `.strict()` and the edge refuses a response that adds one.
6. **Opening a case** is `admin_morpheo_case_read`, `platform_super_admin` alone,
   shaped like break-glass: one POST with a category and a justification of at
   least 20 characters, nothing to unlock, nothing kept by the console. Morpheo
   writes the access (who, when, category, the admin's words) before it answers,
   and shows every access inside the case. The edge's audit event names the case
   and the category, without the free text.

## Consequences

- Morpheo gains four tables and five internal routes; the edge two admin routes;
  identity one capability; the report service one optional field. No new
  deployable, dependency or secret.
- Deploy order: report and edge before morpheo (both new fields are optional on
  the receiving side), then the migration, then one backfill call.
- Durable audit of console actions still waits for the event transport; for
  cases, morpheo's own access rows are the durable record.
- A case is pseudonymised health data, not anonymous data: GDPR still applies.
