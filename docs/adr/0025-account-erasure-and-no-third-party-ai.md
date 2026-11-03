# ADR 0025 — Account deletion leaves no sign-in data behind, and no third-party AI reads patient text

- Status: Accepted (owner decisions, 2026-11-03)
- Date: 2026-11-03
- Decides: §13 (retention and erasure), §15 (AI), the privacy policy v4 and the health-data consent v3

## Context

A review of every processor and store against the privacy texts (2026-11-03) found
that deleting an account left the person's email in three places: the Firestore
session documents (never deleted, only marked revoked, with no expiry), the
Notification module's delivery log (`recipient`, no retention) and the Firebase
Authentication account itself. It also found that Morpheo's AI extraction sent
the pseudonymised free text of interviews to OpenAI's US endpoint, because the
EU-only guard (`PATIENT_DATA_ALLOWED`) was never switched on, while the texts said
nothing is shared with third parties. The owner decided not to pay for any AI.

## Decision

1. **Deleting an account erases how the person signs in.** After the services that
   hold their data have erased it, the edge deletes every Firestore session of the
   account and the Firebase Authentication account (in every accepted Auth
   project), and tells the worker to erase the delivery log rows addressed to the
   session's email. The identity account is deleted after everything that can still
   fail, and the sign-in identity last, so a failure leaves the person able to try
   again. Each erasure is tried and the first failure is raised: nothing fails
   silently or halves the work.
2. **What nobody asked to erase expires.** Firestore TTL policies delete session
   documents after `expiresAt` and the sign-in-link throttle after `lastSentAt`.
   The delivery log is purged daily at 90 days (`NOTIFICATION_LOG_RETENTION_DAYS`,
   scheduler job `cleanup-notification-log`, 04:00 Madrid).
3. **Morpheo's AI is off.** `AI_EXTRACTION_ENABLED=false`, and the `OPENAI_API_KEY`
   is no longer mounted in Morpheo, so flipping the flag alone would send nothing.
   The interview asks every question. The EU-only guard stays in the code for the
   day the AI comes back, and bringing it back needs a new decision and new texts.
   The report service keeps its key: it embeds approved protocol text, never data
   about a person.
4. **The texts say what is true.** Privacy policy v4 and health-data consent v3
   (es/en/ca/fr, drafts for legal review) name the real processors and where they
   run, list the account data and technical logs with their retention, state that
   no data goes to third-party AI and describe the browser storage.

## Consequences

- Edge, worker, Terraform and one identity migration change; Morpheo changes by
  configuration only. No new deployable, dependency or secret.
- Firestore TTL deletes within about a day of the timestamp, not at it.
- The audit database still keeps its events past account deletion (identifiers and
  hashes only), as the DPIA records.
- Publishing the new legal versions makes people who accepted the health-data text
  before accept it again.
- Until the configuration is applied in production, the old behaviour stands.
