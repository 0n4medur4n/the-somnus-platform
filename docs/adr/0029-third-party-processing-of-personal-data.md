# ADR 0029 — Third-party processing of personal data

- Status: Accepted (effective when this PR merges)
- Date: 2026-11-11
- Amends: ADR 0025, decisions 3 and 4. Precedent: ADR 0027 states the amendment in the new record and leaves the earlier record unchanged.
- Decides: §13, §15, §21
- Detail: [notes](0029-third-party-processing-of-personal-data-notes.md)

## Context

ADR 0025 decision 3 said Morpheo's model is off and that the report service embeds approved protocol text only. Decision 4 said no data goes to a third-party AI. The code and the committed Cloud Run composition in `infrastructure/terraform/environments/dev/main.tf` do not match that pair of sentences. Decision 2 of ADR 0025, the expiry of sessions and of the delivery log, is unchanged.

## Decision

1. **Name the processing the repository can show.** Each provider, the service that calls it, the data class, the purpose, the endpoint the repository configures, and the flag and its default are in the notes. A region, a provider retention period, a training exclusion or a contract is stated only where the code or the committed configuration sets it.
2. **Free-text answers are not sent to OpenAI by the committed interview configuration.** `AI_EXTRACTION_ENABLED` is `false` on morpheo-service and `OPENAI_API_KEY` is not mounted there. The code default of the flag is `true`; with no key the call does not run. When that path is on, the code pseudonymises the text, the model extracts, the person confirms, and the rule engine decides. The model does not score, flag, diagnose or set the level.
3. **The report of the current interview is approved sentences.** Funnel v2 is on by default. That report is not written, translated or proofread by OpenAI. A separate route, `GET /v1/assessments/:sessionId/report`, sends the level, the routes and the protocol wording to OpenAI when the report service has a key. The dev composition mounts that key and does not set `OPENAI_BASE_URL`, so the client uses `https://api.openai.com/v1`. Chat calls set `store` to false.
4. **Dictation audio leaves the browser in the clear, over TLS, to AssemblyAI.** In the app and in the staff console the browser streams 16 kHz PCM to `wss://streaming.eu.assemblyai.com`. The worker only mints a token. Drive encryption does not cover that audio. The platform's servers do not receive it.
5. **Staff proofreading and reading aloud are Google, in europe-west3, and they are not the person's interview.** Proofreading is on (`PROOFREAD_ENABLED=true`, Gemini on Vertex). Reading aloud is on (`TTS_ENABLED=true`, `https://eu-texttospeech.googleapis.com`). Translation of staff documents is off unless `TRANSLATE_ENABLED` is set; Terraform does not set it.
6. **The privacy policy, the terms and the health-data consent say this and nothing the repository does not prove.**

## Open questions

- Where OpenAI, TiDB Cloud, Firebase Authentication and Brevo process a request, and how long each keeps it.
- Whether any of them trains a model on it, and whether a data-processing agreement is in force.
- Whether the 30-day object recovery window committed in Terraform has been applied. Until that is shown, ADR 0018 still says a deleted photo is gone.

## Consequences

- ADR 0025 decision 3 is not the description of processing. The interview flag stays off. The report service still has an OpenAI key.
- The texts in `docs/legal/` are the wording. The copies served inside the app stay on the current `legal_document_versions` rows until a new version is inserted. This record does not insert one.
- A person who already accepted is asked again only when a newer version exists and they next start an interview. The old receipt is kept.
