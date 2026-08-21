# Runbook: incident response

Build plan **Checkpoint 13.2** and **§21** ("incident-response runbook"). Covers
availability, integrity, and **personal-data breach** incidents. Because the
platform processes health-adjacent data, a confirmed breach carries a **GDPR
Art. 33 duty to notify the supervisory authority within 72 hours** — that clock
governs the timeline below.

- **On-call owner:** platform owner (until a rota exists).
- **Comms channel:** dedicated incident channel; one **Incident Commander (IC)**
  per incident.

---

## 1. Severity

| Sev | Definition | Examples |
|-----|-----------|----------|
| **SEV1** | Confirmed/suspected personal-data breach, or full outage of a public path | Health data exposed; auth bypass; `somnus_identity`/`somnus_morpheo` data loss |
| **SEV2** | Degraded service, single internal service down, no data exposure | report generation failing; dead-letter queue filling |
| **SEV3** | Minor / contained, no user impact | elevated 5xx on one endpoint, self-recovering cold starts |

Any credible suspicion of health-data exposure is **SEV1** until disproven.

---

## 2. Response flow

1. **Detect & declare.** Trigger sources: monitoring alerts (elevated 5xx, failed
   readiness, pool exhaustion, dead-letter tasks, report failures, auth anomalies,
   cost spikes), user report, or a security finding. Declare severity and name an IC.
2. **Contain.** Stop the bleeding before root-causing:
   - Suspected auth/session compromise → rotate the affected secret in Secret
     Manager and force session invalidation; the edge revokes on next request.
   - Compromised or misbehaving service → roll back to the last-good Cloud Run
     revision (`docs/runbooks/rollback.md`); Cloud Run keeps prior revisions.
   - Data corruption → freeze writes to the affected **logical database only** and
     prepare a restore (`docs/runbooks/backup-restore.md`).
   - Leaked credential → revoke it, rotate in Secret Manager, redeploy.
3. **Assess data impact (breach triage).** Determine whether **personal data**
   (especially the health-adjacent `somnus_morpheo` / reporting data) was
   accessed, altered, or lost, and roughly how many subjects. Start the **72 h
   clock at the moment of awareness.** Audit trail (`somnus_audit`) and structured
   logs are the evidence source — remember they hold **hashes only**, never raw
   health text.
4. **Eradicate & recover.** Remove the cause (patch, config, revoked access),
   restore data if needed, and verify readiness probes + a smoke test pass.
5. **Notify (if breach).** For a confirmed personal-data breach:
   - **Supervisory authority within 72 h** of awareness (Art. 33) unless the
     breach is unlikely to risk individuals' rights.
   - **Affected individuals without undue delay** if the risk is high (Art. 34).
   - Loop in the **DPIA owner** (`docs/security/dpia.md`) for the risk assessment
     and processor coordination (GCP, Firebase, TiDB Cloud, Brevo, OpenAI).
6. **Close & learn.** Blameless post-incident review within 5 working days →
   timeline, root cause, corrective actions. **Any new attack surface adds a row
   to `docs/security/threat-validation.md` with a proving test** before the
   incident is closed.

---

## 3. Do-not / guardrails during an incident

- Restore into a **new** database target and validate before cutover — never
  overwrite a live database in place.
- Never disable the log **redaction pipeline**, `AI_REWRITE_ENABLED` gating, or
  the forbidden-phrase scanner to "debug faster" — these are data-protection
  controls.
- Never widen a service account's IAM to expedite recovery; the
  least-privilege check will fail CI and it re-opens the risk that was closed in
  Checkpoint 13.1.
- Never paste raw health data, tokens, cookies, or secrets into the incident
  channel or tickets.

---

## 4. Contacts & references

- DPIA / breach assessment: `docs/security/dpia.md`
- Rollback: `docs/runbooks/rollback.md`
- Backup/restore: `docs/runbooks/backup-restore.md`
- Threat catalogue: `docs/security/threat-validation.md`
- Processors: GCP, Firebase (`the-somnuss`), TiDB Cloud, Brevo, OpenAI — each with
  a DPA; engage their incident channels when the incident touches their surface.
