# ADR 0029 — notes

Evidence for [ADR 0029](0029-third-party-processing-of-personal-data.md). Line numbers are from `origin/main` at `0b987d3`.

Number 0029 is the next integer that is free on `origin/main` and not already used on an origin branch. 0023 is the Nox record on the local `docs/nox-adr` branch. 0028 is Mi Sueño on `origin/docs/mi-sueno-adr`.

## Providers

| Provider | Caller | Data | Purpose | Endpoint in the repo | Gate and default | If off or no key |
|---|---|---|---|---|---|---|
| OpenAI chat, interview extraction | morpheo-service | Pseudonymised free text, the question, closed targets. Names, emails, phones, identity numbers replaced locally first (`pseudonymise.py`). | Extract explicit facts. The person confirms. The engine decides. | `OPENAI_BASE_URL` default `https://api.openai.com/v1` (`config.py` 65). `store=False` (`provider.py` 129, 138). | `AI_EXTRACTION_ENABLED` code default `true` (`config.py` 59). Dev composition sets `false` and does not mount the key (`environments/dev/main.tf` 293–301). `PATIENT_DATA_ALLOWED` default `false`; it only refuses to boot when true and the URL is not the EU one (`config.py` 82–92). | No extractor. Every question is asked (`factory.py` 16–24). |
| OpenAI chat, older person report | somnus-report-service, `GET /v1/assessments/:sessionId/report` and v1 PDF | Level, routes, protocol wording. No name, email, id or free text (`narrative.py` 12–14, 128–154). Translation sends the stored explanation JSON (`narrative.py` 217–249). | Write or translate the explanation. L0 is not sent (`narrative.py` 180–182). | `openai_base_url()` falls through to `https://api.openai.com/v1` (`openai_endpoint.py` 16–22). The same file describes that URL as processed in the US. `store=False` (`openai_adapter.py` 38–65). | Key mounted in the dev composition (`main.tf` 347–355). `AI_REWRITE_ENABLED` default `true` swaps only human-approved fixed sentences (`config.py` 94–100); it is not this live write. The app calls this route only when `FUNNEL_V2_ENABLED` is false (`Assessment.tsx` 51). That flag defaults true (`config.py` 49) and Terraform does not set it. | `provider` is `None`. The protocol wording is shown (`narrative.py` 181). |
| OpenAI embeddings | somnus-report-service | Approved library sentences and corpus text. The passage search has no field for the person (`funnel_passages.py` 6–8). | Find excerpts. Not the clinical decision. | Same base URL. The embeddings call has no `store` argument (`openai_embedding_adapter.py` 8–9, 26–29). | Same key. | Excerpts are omitted (`funnel_passages.py` 12–14). |
| Gemini on Vertex | somnus-report-service | Staff document text, when a member of staff asks. | Proofread. Translate only if enabled. | `https://{location}-aiplatform.googleapis.com/...` (`vertex_adapter.py` 48–50). `VERTEX_LOCATION` default `europe-west3` (`config.py` 120). Dev composition sets the project region (`main.tf` 340–345). | `PROOFREAD_ENABLED` code default `false` (`config.py` 104); dev composition `true`. `TRANSLATE_ENABLED` code default `false` (`config.py` 114); Terraform does not set it. | The console is told the feature is unavailable. |
| AssemblyAI | Browser, token from somnus-worker | 16 kHz PCM audio. App: free-text and yes/no note of an open interview. Console: the document being dictated. | Transcription. | `wss://streaming.eu.assemblyai.com/v3/ws` (`speech.config.ts` 16–19). Token host `https://streaming.assemblyai.com/v3/token` (line 14). | Key mounted on the worker (`main.tf` 414). Empty key: dictation is not configured (`speech.service.ts` 107–108). | No token. |
| Google Cloud Text-to-Speech | somnus-worker | The passage text, after the browser has decrypted it. | Read aloud. | `https://eu-texttospeech.googleapis.com` (`speech.config.ts` 28). | `TTS_ENABLED` code default `false` (line 20–23); dev composition `true` (`main.tf` 406–408). | Not configured. |
| Brevo | somnus-worker | Recipient email, subject, HTML and text of the message (`brevo.client.ts` 31–36). | Transactional mail. | `https://api.brevo.com/v3/smtp/email` (line 15). | Key mounted (`main.tf` 413). Code default empty (`notification.config.ts` 11). | No real send in tests; a missing key does not invent a sender. |
| Google Cloud Run, Storage, Firestore, Tasks | The five services | Account and health data in TiDB via the app; session email in Firestore; files in buckets. | Run the product. | Region `europe-west3` (`environments/dev/variables.tf` 11–14). Firestore `location_id = var.region` (`main.tf` 882–886). | Not a feature flag. | — |
| Firebase Authentication | edge-api | Email and the Firebase uid, deleted on account erasure (`firebase.service.ts` 149; `me.service.ts` 159–201). | Sign-in. | No location is set in this repository. | — | — |
| Firebase Hosting | Static sites | The pages. The session cookie is `__session`. | Serve the sites. | Hosting rewrites name `europe-west3` in `firebase.json`. | — | — |
| TiDB Cloud | Each service's own database | The service's tables. | Primary store. | No region and no cloud account are set in Terraform. | — | — |

The shared module used by `environments/production` and `environments/staging` does not mount `OPENAI_API_KEY`, `BREVO_API_KEY` or `ASSEMBLYAI_API_KEY`, and does not set `AI_EXTRACTION_ENABLED`. With no key, extraction and the report chat do not run.

## Consent

Purposes: `terms_acceptance`, `privacy_policy_acknowledgement`, `health_data_processing`, `professional_sharing`, `marketing`, `research_participation` (`packages/api-contracts/src/consent/consent-purpose.ts` 7–14). None is named for third-party AI or for dictation. Health-data consent is the text shown before the interview.

The app records `health_data_processing` for a signed-in person who has not accepted the current version, and it will not start without the checkbox (`FunnelAssessment.tsx` 92–97, 150–157, 279–281). An anonymous person checks the box; no receipt is written. `POST /v1/funnel/sessions` does not read the consent module. Dictation checks only that the interview is open on a free-text or yes/no-note step (`funnel.service.ts` 148–163). The report route does not read consent.

Declining leaves the start button disabled. Withdrawal sets `current` false for the next interview; it does not delete the case record. A new `legal_document_versions` row makes `current` false (`consent.service.ts` 127–132) and the next interview shows the new text. Old receipts keep their version (`legal-documents.schema.ts` 23–28).

## What leaves the browser before Drive encryption

ADR 0019's addendum already says dictation and reading aloud leave end-to-end encryption on purpose. The console copy says the audio is not covered by Drive encryption and that the resulting text is saved encrypted (`apps/somnus-admin/src/i18n/locales/es.json` 798–799).

In the clear, over TLS, before any Drive key: the PCM audio and the AssemblyAI token in the socket URL (`speech.service.ts` 120–133; `dictation.ts` 5–10). The stored document is ciphertext. The servers do not receive the audio. For reading aloud, the decrypted passage is posted to the worker and then to Google (`speech.service.ts` 140–166).

## Retention the code implements

| Fact | Where | In the public text |
|---|---|---|
| Unsaved anonymous interviews, 30 days | `UNCLAIMED_ASSESSMENT_TTL_DAYS` default 30 | Yes |
| Case record, 24 months, unlinked on account deletion | `FUNNEL_CASE_RETENTION_MONTHS` default 24; `funnel.py` 113–118 | Yes |
| Delivery log, 90 days, and erased for that email on account deletion | `NOTIFICATION_LOG_RETENTION_DAYS` default 90; `me.service.ts` 190–194 | Yes |
| App session, 7 days, then Firestore TTL on `expiresAt` | `SESSION_TTL_SECONDS` default 7 days; `main.tf` 909–915 | Yes |
| Account deletion removes sign-in, sessions, photo object, saved assessments, stored person reports | `me.service.ts` 159–201 | Yes |
| Identity audit event of the erasure is written first | `account-deletion.service.ts` 25–34 | Yes, without the answer text |
| 30-day soft delete on photos, Drive, corpus files, export objects | `object_recovery_seconds = 2592000` (`main.tf` 76). The production module still sets profile photos to 0. | No. Apply is not shown by the repository. |
| TiDB backup retention | Not set. The export bucket deletes live objects after 90 days and grants no service account (`main.tf` 541–558). | No |
| A 30-day store of IP, browser and URL | Stated in legal version 4. No such job is in the code. | No |

## Publishing a new legal version

`legal_document_versions` is insert-only. `version` is `MAX(version)` per document. A receipt points at one row. `contentSha256` is the SHA-256 of that row (`consent.service.ts` 35–48). Tests compare the hash with the stored text; they do not pin the prose. CI does not hash the files in `docs/legal/`.

The app serves the latest row. Marketing now renders `docs/legal/{locale}/privacy.md` and `terms.md`. The health-data file is the consent wording and is not a database row. Inserting privacy version 5 and health-data version 4, in es, en, ca and fr, is a new consent migration. This change does not add it. People who accepted version 4 or health-data version 3 are asked again on the next interview only after that insert. Nothing in the current code emails them.
