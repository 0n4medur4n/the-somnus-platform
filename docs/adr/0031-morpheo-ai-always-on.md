# ADR 0031 — Morpheo's AI is always on, in every language

- Status: Accepted (owner decision, 2026-11-25)
- Date: 2026-11-25
- Supersedes: decision 3 of ADR 0025 («Morpheo's AI is off»)
- Decides: §15 (AI), ADR 0020 (amendment of 21/11/2026, the AI in other languages)

## Context

ADR 0025 (2026-11-03) decided to switch Morpheo's AI off: `AI_EXTRACTION_ENABLED=false`
and no `OPENAI_API_KEY` mounted. That configuration was never applied. Production
kept the key and left the flag unset, and the code default is on, so the AI of
v0.2 p. 14 (extraction from the narrative, confirmation by the person, risk
screen) kept running in production: the service logs show successful calls to
`gpt-6-luna` through November. The README and ADR 0025 said the opposite.

On 21/11/2026 the four-language interview limited the AI to Spanish interviews,
because its prompt is in Spanish and the local pseudonymiser uses a Spanish model.

On 25/11/2026 the owner decided: the AI is on in production, always, and the
documentation says so.

## Decision

1. **The AI is always on in production.** Terraform sets
   `AI_EXTRACTION_ENABLED = "true"` explicitly and mounts `OPENAI_API_KEY`; it no
   longer depends on a code default.
2. **In every language.** Catalan, English and French interviews go through the
   same pipeline as Spanish ones: names, places, centres, dates, phones, emails and
   DNI/NIE are pseudonymised before the call; the prompt carries the interview's
   own questions; the confirmation screen («Por lo que nos ha contado,
   entendemos…») reads in the interview's language. The owner accepted that the
   Spanish name model catches fewer proper names in English and French text.
3. **Nothing else changes.** The AI only proposes answers taken from the person's
   own words; nothing counts until the person keeps or corrects it; it adds safety
   questions, never alerts; the final text comes only from the approved templates
   and catalogue (§15, ADR 0020). If the call fails or the key is missing, the
   interview asks every question.

## Consequences

- The privacy texts and the DPIA must name OpenAI as a processor of the
  pseudonymised free text, with its endpoint (today the US endpoint; the EU
  endpoint guard `PATIENT_DATA_ALLOWED` stays off) and retention (`store=False`).
  ADR 0025's statement that no data goes to third-party AI no longer holds for
  Morpheo. This is a pending legal item, not a code change.
- Turning the AI off again needs a new decision: the flag in Terraform, not a
  missing setting.
