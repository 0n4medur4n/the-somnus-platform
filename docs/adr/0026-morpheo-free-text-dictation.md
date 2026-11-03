# ADR 0026 — Dictation of Morpheo free-text answers through AssemblyAI (EU)

- Status: Accepted (owner decision, 2026-11-03)
- Date: 2026-11-03
- Decides: the free-text steps of the embudo v0.2 (Q01, Q02, Q06, Q10, Z2 and a yes/no note)

## Context

Those steps ask the person to explain in their own words. Typing is hard for some of them. The staff Drive already dictates with AssemblyAI's EU streaming (ADR 0019): the browser sends 16 kHz PCM straight to `streaming.eu.assemblyai.com`, the worker only mints a one-minute token, and the audio never touches our servers. ADR 0025 turned off the model that read free text and sent it to OpenAI. Dictation is not that model: it writes down what the person said, and Morpheo receives only the text they submit, through the answer path it already has.

## Decision

- A microphone on each free-text box. The words appear in the box as they are heard; a finished sentence stays and can be edited. Spoken punctuation works as in the Drive (`coma`, `punto`, `punto y aparte`, and the same in en, ca, fr).
- Before the first use after a reload, the page says the voice goes to AssemblyAI in the EU, that the audio is not kept here, and that a name, phone, email or identity number must not be said. The existing check still refuses those in the text before it is sent.
- `POST /v1/funnel/sessions/:id/dictation` mints the pass only while that interview is open on a `free_text` or `yes_no_note` step. Thirty passes per ten minutes per address. The audit event is `morpheo.dictation.started.v1` with the language and the session id, never the words or the audio.
- The token route lives next to the Drive's, because that module already holds the AssemblyAI key. It stores nothing about the interview. Catalan uses `universal-3-6-pro`; the other three languages use `universal-streaming-multilingual`, as in the Drive.
- The app's hosting header allows the microphone for itself (`microphone=(self)`).
- This does not turn Morpheo's extraction model back on. ADR 0025 stands for that.

## Consequences

- AssemblyAI processes health audio under its DPA, in the EU. The privacy text and the health-data consent still say that no data goes to a third-party AI (ADR 0025). They have to name this dictation before it is used with real patients.
- The key stays in Secret Manager (`assemblyai-api-key`), read by the worker only. Nothing new is logged.
- An interview id is the capability, as it already is for answering, plus the rate limit.
