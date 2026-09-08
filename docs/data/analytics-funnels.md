# Privacy-safe analytics funnels

Data source for the Phase 15 statistics dashboards (Addendum A §A2.4), built in
**Checkpoint 14.3**. Implements build plan §9 (BigQuery holds privacy-safe
events only) and §17 (event envelope).

## The pipeline

```
identity emits a §17 event
  -> worker Audit module ingest  (/internal/v1/audit/events, deduped by eventId)
  -> persisted in somnus_audit   (full record, including actor/subject ids)
  -> redactForExport()           (drops the ids; validates the payload)
  -> BigQuery <dataset>.audit_events
  -> buildFunnels()              (the queries below, as a pure function)
```

Two independent guarantees stop personal data reaching BigQuery:

1. **The exporter drops actor and subject ids** for every event, always. Nothing
   in the export can be tied to a person, which is also why there are no
   per-person metrics here and cannot be.
2. **Analytics payloads are strict contracts.**
   `packages/api-contracts/src/analytics/funnel-events.ts` declares one
   `.strict()` schema per analytics event type, and the exporter parses `data`
   with it. A field that is not declared cannot survive — whatever it is called.
   A payload that fails its contract exports as `{}` rather than half-trusted.
   Every other event type still goes through the original denylist sweep as
   defence in depth.

The BigQuery table schema (`modules/bigquery-analytics`) declares exactly the
redacted row, so an undeclared field is rejected by the streaming insert too.

## Events

| Event type | Emitted where | `data` |
|---|---|---|
| `identity.registration.started.v1` | provision entered | `roleBranch` |
| `identity.registration.completed.v1` | provision succeeded | `roleBranch` |
| `identity.professional.verification.requested.v1` | verification case opened | `caseId` |
| `identity.professional.verification.decided.v1` | **Checkpoint 15.2** (verifier queue) | `caseId`, `decision`, `timeToDecisionMs` |
| `identity.organization.invitation.created.v1` | invitation issued | `invitationId` |
| `identity.organization.invitation.previewed.v1` | accept screen looked it up | `invitationId` |
| `identity.organization.invitation.accepted.v1` | membership attached | `invitationId` |
| `identity.organization.invitation.expired.v1` | preview or accept refused it | `invitationId`, `stage` |

The opaque user id travels in the envelope's `subject`, never in `data`, and is
dropped before export.

## Funnels

Defined once, as a pure projection over the exported rows:
`services/somnus-worker/src/modules/audit/export/funnels.ts`. Checkpoint 15.4's
BigQuery queries should reproduce these definitions exactly; the reconciliation
test (`test/analytics-export.test.ts`) is what pins them.

### Registration — by role branch

`started` and `completed` counts per `adult` / `parent` / `professional`.

**What "started" means.** The registration was *submitted* and passed contract
validation, so `started → completed` measures how often a submitted
registration fails (a conflict, a downstream error). It does **not** measure
someone abandoning the form: no server sees that. Measuring true abandonment
needs a client-side signal, which belongs with the dashboard work, not here.
Read this conversion as *submission success rate*, and do not present it as
form completion.

### Verification

`opened` / `approved` / `rejected`, counting **distinct `caseId`s**, plus
`medianTimeToDecisionMs` over decided cases.

Until Checkpoint 15.2 ships the verifier queue nothing emits a decision, so
`approved` and `rejected` are 0 and the median is `null`. That is the correct
reading of the current system, not a broken metric.

### Invitation (Nox)

`issued` / `previewed` / `accepted` / `expired`, counting **distinct
`invitationId`s**, plus `previewViews` (raw preview calls, including reloads).

Distinct counting is deliberate: someone reloading the accept screen must not
read as extra invitations. `previewViews` is kept alongside because view volume
is itself interesting.

## Configuration

| Env var | Value |
|---|---|
| `BIGQUERY_PROJECT` | the backend project id |
| `BIGQUERY_DATASET` | `somnus_analytics_<env>` |
| `BIGQUERY_AUDIT_TABLE` | `audit_events` |

Wired for **staging and production** by `modules/environment`. Unset in local
dev and CI, where the export is a deliberate no-op — the redaction still runs,
there is simply no sink. Dev's Terraform is still inline
(production-readiness gap #9), so dev has no dataset either; that matches how
dev has always run.

The worker's service account holds `roles/bigquery.dataEditor` **on the dataset
only**, never project-wide.
