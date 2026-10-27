# ADR 0022 — The one-page patient report, and sources authorised by the owner

- Status: Accepted (owner decision, 2026-10-27)
- Date: 2026-10-27
- Decides: §14 (Morpheo result), §15 (AI), Addendum B §B4 (rights)

## Context

The clinical lead approved the proposal for a patient report on 27/10/2026, and
the owner decided it reaches patients as it is, with nothing marked as a draft.
The owner also stated that The Somnus holds permission to use all the clinical
source documents it has, and asked that the rights check not block uploading them.

## Decision

1. **The report.** Morpheo builds a one-page report for the person and a second
   page for them to hand to a professional (`morpheo.funnel.informe`, artifact
   `clinical/morpheo_informe_v3.json`). Every clinical sentence is a sentence of an
   already approved template, an approved catalogue phrase or a literal v0.2
   phrase; the loader refuses to start otherwise. No model writes any of it
   (§15). An emergency is only the urgent message. `REPORT_V3_ENABLED` is on by
   default; off, the result carries no report and nothing else changes.
2. **The rights status `owner_authorised`.** A fifth status beside §B4's four: the
   owner's statement that The Somnus holds permission to use the document in
   full. It asks for no licence or holder. The four stricter statuses, their
   evidence rules and their tests are unchanged; the two independent checks
   (publish, embedding) still run and still require a declared, known status.
3. **Upload by script.** `python -m report.jobs.upload_corpus` drives the console's
   own routes (create, upload, publish and embed) for the PDFs staged in a
   bucket, then verifies each document: published, original byte-identical,
   every chunk embedded with the configured model and dimensions.

## Consequences

- The owner answers for the permission when choosing `owner_authorised`; the
  history records the script's fixed actor and the changelog says so.
- Retrieval remains explanation-only (§14b): a citation is resolved by id from the
  clinical artifact, never from these documents.
- Reverting is a flag (`REPORT_V3_ENABLED=false`) for the report, and `retire` for
  any document.
