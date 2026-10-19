"""One free-text answer through the AI: pseudonymise → ask → validate → restore.

The result is a `Record` the interview stores next to the answer, and one
audit event. Nothing here can block the interview: any failure (provider down,
timeout, refusal, output out of schema) gives a failed record, and the
interview then asks every question plus the safety fallback (`ai_steps`).
"""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import dataclass

from morpheo.ai.audit import AiCallEvent, build_event, log_event
from morpheo.ai.prompts import (
    PROMPT_VERSION,
    SCHEMA_NAME,
    SYSTEM,
    fingerprint,
    response_schema,
    user_message,
)
from morpheo.ai.provider import ModelRequest, Provider, ProviderError
from morpheo.ai.pseudonymise import pseudonymise
from morpheo.funnel.artifact import FunnelArtifact
from morpheo.funnel.extraction import (
    EXTRACT_AFTER,
    PARTIAL,
    SCREEN_ONLY,
    Item,
    Record,
    is_ai_key,
    is_record_key,
    record_of,
    targets,
    validate,
)
from morpheo.funnel.interview import Answer, Interview


@dataclass(frozen=True)
class AiCall:
    record: Record
    event: AiCallEvent


def purpose_of(step_id: str) -> str | None:
    """ "extraccion" after a core free text, "cribado" (risk only) after Z2, else None."""
    if step_id in EXTRACT_AFTER:
        return "extraccion"
    if step_id in SCREEN_ONLY:
        return "cribado"
    return None


def settled_ids(artifact: FunnelArtifact, answers: Mapping[str, Answer]) -> set[str]:
    """What the model need not be asked about: answered, confirmed, or proposed already."""
    iv = Interview(artifact, answers)
    ids = {k.split("@")[0] for k in iv.answers if not is_ai_key(k)}
    ids |= {k.removesuffix(PARTIAL) for k in iv.answers if k.endswith(PARTIAL)}
    for key, answer in answers.items():
        record = record_of(answer) if is_record_key(key) else None
        if record is not None:
            ids |= {item.id for item in record.items}
    return ids


class AiExtractor:
    def __init__(self, provider: Provider) -> None:
        self._provider = provider

    def process(
        self,
        artifact: FunnelArtifact,
        answers: Mapping[str, Answer],
        source_key: str,
        text: str,
    ) -> AiCall | None:
        """The record for `text` (the answer to `source_key`), or None when no call is due."""
        step_id = source_key.split("@")[0]
        purpose = purpose_of(step_id)
        if purpose is None or not text.strip():
            return None
        call = run(
            artifact,
            answers,
            source_key=source_key,
            text=text,
            provider=self._provider,
            extract=purpose == "extraccion",
        )
        log_event(call.event)
        return call


def run(
    artifact: FunnelArtifact,
    answers: Mapping[str, Answer],
    *,
    source_key: str,
    text: str,
    provider: Provider,
    extract: bool,
) -> AiCall:
    step_id = source_key.split("@")[0]
    stage = "end" if step_id in SCREEN_ONLY else None
    question = artifact.step(step_id, stage).text
    pseudo = pseudonymise(text)
    allowed = targets(artifact, settled_ids(artifact, answers)) if extract else ()
    user = user_message(artifact, question, pseudo.text, allowed)
    schema = response_schema(allowed)
    request = ModelRequest(SYSTEM, user, schema, SCHEMA_NAME, pseudo.text, PROMPT_VERSION)
    started = time.monotonic()
    output: str | None = None
    model = provider.model
    status = "ok"
    try:
        reply = provider.complete(request)
        output, model = reply.text, reply.model
    except ProviderError as exc:
        status = exc.code
    except Exception:  # never let the AI block the interview
        status = "provider_error"
    latency_ms = int((time.monotonic() - started) * 1000)

    items: list[Item] = []
    risk: dict[str, str] = {}
    discarded = 0
    if output is not None:
        checked = validate(artifact, output, pseudo.text, allowed, extract=extract)
        if checked is None:
            status = "out_of_schema"
        else:
            proposed, risk, discarded = checked
            for item in proposed:
                # Put every marker back; the span must then be the person's own words.
                evidence = pseudo.restore(item.evidence)
                if evidence not in text:
                    discarded += 1
                    continue
                value = pseudo.restore(item.value) if isinstance(item.value, str) else item.value
                items.append(Item(item.id, value, evidence))
    ok = status == "ok"
    record = Record(
        source=source_key,
        status="ok" if ok else "failed",
        items=tuple(items) if ok else (),
        risk=risk if ok else {},
        discarded=discarded,
        model=model,
        prompt_version=PROMPT_VERSION,
    )
    event = build_event(
        purpose="extraccion" if extract else "cribado",
        model=model,
        prompt_version=PROMPT_VERSION,
        region=provider.region,
        status=status,
        request_fingerprint=fingerprint(SYSTEM, user, schema),
        output=output,
        pseudonymised_count=pseudo.count,
        items=len(record.items),
        discarded=discarded,
        latency_ms=latency_ms,
    )
    return AiCall(record, event)


__all__ = ["AiCall", "AiExtractor", "purpose_of", "run", "settled_ids"]
