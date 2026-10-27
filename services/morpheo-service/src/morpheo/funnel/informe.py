"""The patient's report -- one page -- and the professional's page (pure, deterministic).

A report is the engine's own result laid out for reading: the sentence that says
what to do first, what the person told us, what it means, what to do now, when
not to wait, and the limits; and, for the person to hand to a doctor or
therapist, a page with the orientation, the rules behind it and the answers
with where each came from.

Nothing here is written by a model, and nothing is new clinical text that is not
in `clinical/morpheo_informe_v3.json`: the headline is a sentence of an already
approved template; the other texts are approved sentences or literal v0.2
phrases, or the clinical lead's own (the artifact says which are still drafts).
The loader fails loudly if a sentence it carries is not in the approved sources,
and `REPORT_V3_ENABLED` refuses to start with a draft artifact, so a draft never
reaches a patient.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact
from morpheo.funnel.catalogue import Catalogue
from morpheo.funnel.display import answer_label
from morpheo.funnel.extraction import is_ai_key
from morpheo.funnel.interview import SAFETY, Interview
from morpheo.funnel.render import question_text
from morpheo.funnel.rules import FunnelResult

INFORME_FILE = Path(__file__).resolve().parents[3] / "clinical" / "morpheo_informe_v3.json"
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])")
_SLOT = re.compile(r"\{([A-Za-z_0-9]+)\}")
_SKIP_BASES = {"PROT", "S2_aviso", "S2_seguro", "Z1"}
ALL = "todas"

ORIGIN_ANSWERED, ORIGIN_NARRATIVE, ORIGIN_CORRECTED = "answered", "narrative", "corrected"
WHEN_MOMENT, WHEN_END, WHEN_CONFIRMED = "moment", "end", "confirmed"


class InformeError(ValueError):
    """The report artifact is malformed, or says something the approved sources do not."""


@dataclass(frozen=True)
class Resource:
    code: str
    text: str


@dataclass(frozen=True)
class SafetyRow:
    question: str
    answer: str
    when: str


@dataclass(frozen=True)
class AnswerRow:
    id: str
    question: str
    answer: str
    origin: str


@dataclass(frozen=True)
class FlagRow:
    id: str
    reasons: tuple[str, ...]


@dataclass(frozen=True)
class Professional:
    main_action: str | None
    associated_actions: tuple[str, ...]
    templates: tuple[str, ...]
    rules: tuple[str, ...]
    flags: tuple[FlagRow, ...]
    alerts: tuple[str, ...]
    pending_data: tuple[str, ...]
    safety: tuple[SafetyRow, ...]
    answers: tuple[AnswerRow, ...]
    narrative: str | None


@dataclass(frozen=True)
class Informe:
    approved: bool
    layout: str  # "urgent" | "standard"
    headline: tuple[str, ...] = ()
    secondary: tuple[str, ...] = ()
    summary: str | None = None
    steps: tuple[str, ...] = ()
    help_sentences: tuple[str, ...] = ()
    resources: tuple[Resource, ...] = ()
    limits: tuple[str, ...] = ()
    sources: tuple[str, ...] = ()
    professional: Professional | None = field(default=None)


# --- the artifact ---


@dataclass(frozen=True)
class InformeArtifact:
    raw: Mapping[str, Any]

    @property
    def approved(self) -> bool:
        return bool(self.raw["meta"]["approved"])


def _strings(node: Any) -> Iterator[str]:
    if isinstance(node, str):
        yield node
    elif isinstance(node, Mapping):
        for value in node.values():
            yield from _strings(value)
    elif isinstance(node, list):
        for value in node:
            yield from _strings(value)


def sentences(text: str) -> list[str]:
    return [part for part in _SENTENCE.split(text.strip()) if part]


def parse(
    raw: Mapping[str, Any], artifact: FunnelArtifact, catalogue: Catalogue
) -> InformeArtifact:
    """Checks every sentence the report carries against the approved sources."""
    known = set(artifact.templates) | set(catalogue.drafts)
    for table in ("accion", "fuentes"):
        for key in raw[table]:
            if key.startswith("_") or key == "ADAPTAR_TERAPIA":
                continue
            if key not in known:
                raise InformeError(f"{table}: {key!r} is not a template of the artifact")
    v02 = [s for s in _strings(artifact.raw["source"]) if s]
    steps = raw["pasos"]["diario_y_revision"]
    if not any(steps["texto"] in s for s in v02):
        raise InformeError(f"pasos: {steps['texto']!r} is not literal v0.2")
    approved_phrases = [p.text for lst in catalogue.lists.values() for p in lst.phrases]
    for phrase in raw["ayuda"]["frases"]:
        if not any(phrase.rstrip(".") in p for p in approved_phrases):
            raise InformeError(f"ayuda: {phrase!r} is not an approved catalogue phrase")
    for code in raw["ayuda"]["recursos"]:
        if code not in artifact.engine["resources"]:
            raise InformeError(f"ayuda: unknown resource {code!r}")
    items = _v02_sources(artifact)
    for key, numbers in raw["fuentes"].items():
        if key.startswith("_"):
            continue
        for number in numbers:
            if number not in items:
                raise InformeError(f"fuentes: {key} cites [{number}], not in v0.2 p. 15")
    return InformeArtifact(raw)


def _v02_sources(artifact: FunnelArtifact) -> dict[int, str]:
    out: dict[int, str] = {}
    for line in artifact.raw["source"]["sources"]["items"]:
        found = re.match(r"\[(\d+)\]", line)
        if found:
            out[int(found.group(1))] = line
    return out


def load(
    artifact: FunnelArtifact, catalogue: Catalogue, path: Path = INFORME_FILE
) -> InformeArtifact:
    return parse(json.loads(path.read_text(encoding="utf-8")), artifact, catalogue)


def require_approved(informe: InformeArtifact) -> InformeArtifact:
    """What REPORT_V3_ENABLED needs: a report whose texts the clinical lead has signed."""
    if not informe.approved:
        raise InformeError(
            "REPORT_V3_ENABLED needs an approved clinical/morpheo_informe_v3.json "
            "(meta.approved is false: the texts are still drafts)"
        )
    return informe


@lru_cache(maxsize=1)
def informe_artifact() -> InformeArtifact:
    from morpheo.funnel.artifact import funnel_artifact
    from morpheo.funnel.catalogue import funnel_catalogue

    return load(funnel_artifact(), funnel_catalogue())


# --- building a report ---


def _action(informe: InformeArtifact, template: str, text: str) -> tuple[str, ...]:
    wanted = informe.raw["accion"].get(template)
    parts = sentences(text)
    if wanted is None:
        return ()
    if wanted == ALL:
        return tuple(parts)
    try:
        return tuple(parts[i] for i in wanted)
    except IndexError as exc:
        raise InformeError(f"{template}: the approved text has no sentence {wanted}") from exc


def _summary(artifact: FunnelArtifact, catalogue: Catalogue, iv: Interview) -> str | None:
    """What the person confirmed in Z1, from the approved phrases (no new text)."""
    if "Z1" not in iv.answers:
        return None
    text, _ = question_text(artifact.step("Z1"), iv, catalogue)
    found = re.match(r"Esto es lo que he entendido:\s*(.+?)\s*¿Es correcto\?\s*$", text, re.S)
    if found is None:
        return None
    body = found.group(1).strip()
    return body if body.endswith(".") else f"{body}."


def _origin(answer: Any) -> str:
    return {"ia": ORIGIN_NARRATIVE, "ia_corregido": ORIGIN_CORRECTED}.get(
        answer.origin or "", ORIGIN_ANSWERED
    )


def _answers(artifact: FunnelArtifact, iv: Interview) -> tuple[AnswerRow, ...]:
    rows: list[AnswerRow] = []
    seen: set[str] = set()
    for key in iv.answers:
        base = key.split("@")[0]
        if "#" in key or is_ai_key(key) or base in seen or base in _SKIP_BASES or base in SAFETY:
            continue
        seen.add(base)
        definition = next((d for d in artifact.steps if d.id == base and not d.safety), None)
        answer = iv.answer(base)
        if definition is None or answer is None or definition.type == "info":
            continue
        rows.append(
            AnswerRow(
                id=base,
                question=definition.text,
                answer=answer_label(answer, definition, "ask"),
                origin=_origin(answer),
            )
        )
    return tuple(rows)


def _safety(artifact: FunnelArtifact, iv: Interview) -> tuple[SafetyRow, ...]:
    rows: list[SafetyRow] = []
    for key, answer in iv.answers.items():
        base = key.split("@")[0]
        if base not in SAFETY or "#" in key:
            continue
        when = (
            WHEN_MOMENT
            if ("@exception" in key or "@ask_now" in key)
            else WHEN_CONFIRMED
            if key.endswith("@confirm")
            else WHEN_END
        )
        definition = artifact.step(base, "end")
        kind = "confirm" if when == WHEN_CONFIRMED else "ask"
        rows.append(SafetyRow(definition.text, answer_label(answer, definition, kind), when))
    return tuple(rows)


def _flags(result: FunnelResult) -> tuple[FlagRow, ...]:
    reasons = dict(result.flag_reasons)
    return tuple(FlagRow(flag, tuple(reasons.get(flag, ()))) for flag in result.flags)


def build(
    artifact: FunnelArtifact,
    catalogue: Catalogue,
    informe: InformeArtifact,
    iv: Interview,
    result: FunnelResult,
) -> Informe | None:
    """The report of a finished interview, or None when the result has no text to show."""
    if not result.texts:
        return None
    raw = informe.raw
    templates = [t for t, _ in result.texts]
    if result.accion_principal in raw["urgente"]["categorias"]:
        return Informe(
            approved=informe.approved,
            layout="urgent",
            limits=tuple(raw["limites"]["frases"]),
        )
    text_of = dict(result.texts)
    ordered = [o.template for o in result.orientations if o.template in text_of]
    principal = next((t for t in ordered if t in raw["accion"]), None)
    headline = _action(informe, principal, text_of[principal]) if principal else ()
    secondary: list[str] = []
    for template in dict.fromkeys(t for t in ordered if t != principal and t in raw["accion"]):
        secondary.extend(_action(informe, template, text_of[template]))
    resources = artifact.engine["resources"]
    help_sentences = tuple(
        _SLOT.sub(lambda m: str(resources[m.group(1)]), phrase) for phrase in raw["ayuda"]["frases"]
    )
    steps_rule = raw["pasos"]["diario_y_revision"]
    steps = (
        (steps_rule["texto"],) if any(t in steps_rule["para_plantillas"] for t in templates) else ()
    )
    numbers: set[int] = set()
    for template in templates:
        numbers.update(raw["fuentes"].get(template, ()))
    for flag in result.flags:
        numbers.update(raw["fuentes"].get(flag, ()))
    items = _v02_sources(artifact)
    first = iv.answer("Q01")
    return Informe(
        approved=informe.approved,
        layout="standard",
        headline=headline,
        secondary=tuple(secondary[:3]),
        summary=_summary(artifact, catalogue, iv),
        steps=steps,
        help_sentences=help_sentences,
        resources=tuple(Resource(code, str(resources[code])) for code in raw["ayuda"]["recursos"]),
        limits=tuple(raw["limites"]["frases"]),
        sources=tuple(items[n] for n in sorted(numbers)),
        professional=Professional(
            main_action=result.accion_principal,
            associated_actions=result.acciones_asociadas,
            templates=tuple(templates),
            rules=tuple(line for line in result.trace if re.match(r"R\d\d", line)),
            flags=_flags(result),
            alerts=result.alerts,
            pending_data=result.datos_pendientes,
            safety=_safety(artifact, iv),
            answers=_answers(artifact, iv),
            narrative=first.text if first is not None else None,
        ),
    )
