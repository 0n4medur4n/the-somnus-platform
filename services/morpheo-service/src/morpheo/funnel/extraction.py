"""What the AI may take from a free-text answer, and what counts once confirmed.

v0.2 p. 14: «Extraer del relato → completar Q01-Q18 → …» and p. 1: «Cada pregunta
se formula solo si su respuesta no consta ya». The model only *proposes*: this
module

* says which questions a free text may answer (`targets`), each with the
  answer type and the option keys of its v0.2 definition;
* validates the model's output (`validate`): anything outside the schema, any
  value that is not one of the question's own options, and any item whose
  evidence is not a literal span of the person's text is discarded -- nothing
  inferred, and a missing item is never "No" (R03);
* turns the person's decisions on the confirmation screen into answers
  (`expand`): only a confirmed or corrected item reaches the engine; a removed
  one is asked in its turn. No rule ever reads an unconfirmed value.

Q14 is broken down as p. 4 says: «molestias → enfermedades → tratamientos y
cambios → sustancias/cantidad/hora → ayudas ya probadas. Registrar embarazo,
epilepsia o bipolaridad si corresponde». The flags are the names the approved
catalogue already reads (`extracts` of Q14), so R07 (ADAPTAR_TERAPIA) and the
Z1 summary work from a confirmed narrative.

Pure and deterministic: no network, no model. `morpheo.ai` calls the model and
hands its raw JSON here.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact, FunnelArtifactError, StepDef
from morpheo.funnel.interview import NO, YES, Answer

# After which answers the model is asked to extract (the core free texts and
# the note of Q04). Z2 comes after everything, so it is only screened for risk.
EXTRACT_AFTER = ("Q01", "Q02", "Q04", "Q06", "Q10", "Q14")
SCREEN_ONLY = ("Z2",)
# Never taken from a narrative (a DEFAULT the clinical lead can change): the age gate
# and every safety question (only the person's own answer counts), and every
# question answered in the person's own words -- Q01, Q02 (their goal), Q04
# (what changed), Q06 (the night), Q10 (the day after), Q14, Z1-Z2. Each is
# asked as v0.2 asks it; a sentence of the narrative is never offered back as
# the answer to one of them (owner decision 19/10/2026: it read as repetition).
NEVER_EXTRACTED = ("AGE", "Q01", "Q02", "Q04", "Q06", "Q10", "Q14", "PROT", "Z1", "Z2")

# The suffixes of the two records an extraction leaves among the answers.
RECORD, DECISION, EXTRACTED, PARTIAL = "#ia", "#confirmacion", "#extraido", "#parcial"
# Where an expanded answer came from: confirmed as the AI proposed it, or
# corrected by the person on the confirmation screen.
ORIGIN_AI, ORIGIN_CORRECTED = "ia", "ia_corregido"
CONFIRMED, CORRECTED, REMOVED = "confirmado", "corregido", "quitado"
DECISIONS = (CONFIRMED, CORRECTED, REMOVED)
RISK_VALUES = ("si", "no", "dudoso")
RISK_QUESTIONS = ("S1", "S4", "S2")
DURATION_UNITS = ("dias", "semanas", "meses", "años")
SLEEP_UNITS = ("horas",)
_TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_NUMBER_LIMITS = {"Q05": (0, 7)}
MIN_EVIDENCE = 3

# p. 4 (question_block_notes): the Q14 breakdown, as text parts, and the flags
# the catalogue reads. Each text part's label must be literally in that note.
Q14_TEXT_PARTS = (
    ("molestias", "molestias"),
    ("enfermedades", "enfermedades"),
    ("tratamientos", "tratamientos y cambios"),
    ("consumo", "sustancias/cantidad/hora"),
    ("ayudas_probadas", "ayudas ya probadas"),
)
Q14_FLAGS = ("bipolaridad", "epilepsia", "embarazo", "opioides", "sustancias", "medicacion")


@dataclass(frozen=True)
class Target:
    """One thing a free text may answer: a v0.2 question or a Q14 part."""

    id: str
    type: str  # a StepDef type, or "q14_text" | "q14_flag"
    text: str  # what the model is told it is (verbatim v0.2 where it exists)
    options: tuple[str, ...] = ()
    fields: tuple[str, ...] = ()
    units: tuple[str, ...] = ()
    none_option: bool = False


@dataclass(frozen=True)
class Item:
    """A value the model proposed, with the exact words it came from."""

    id: str
    value: Any
    evidence: str


@dataclass(frozen=True)
class Record:
    """What one model call left: stored as the answer `<source>#ia`.

    `status` is "ok" or "failed" (provider error, timeout, output out of
    schema); a failed call has no items and no risk. `risk` is the classifier's
    view of S1/S4/S2: "si", "no" or "dudoso".
    """

    source: str
    status: str
    items: tuple[Item, ...] = ()
    risk: Mapping[str, str] = field(default_factory=dict)
    discarded: int = 0
    model: str | None = None
    prompt_version: str | None = None

    @property
    def uncertain(self) -> bool:
        """A failed call, or a classifier unsure about any safety question."""
        return self.status != "ok" or any(v == "dudoso" for v in self.risk.values())

    def to_json(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "status": self.status,
            "items": [{"id": i.id, "value": i.value, "evidence": i.evidence} for i in self.items],
            "risk": dict(self.risk),
            "discarded": self.discarded,
            "model": self.model,
            "prompt_version": self.prompt_version,
        }

    @staticmethod
    def from_json(data: Mapping[str, Any]) -> Record:
        return Record(
            source=data["source"],
            status=data["status"],
            items=tuple(Item(i["id"], i["value"], i["evidence"]) for i in data.get("items", [])),
            risk=dict(data.get("risk", {})),
            discarded=int(data.get("discarded", 0)),
            model=data.get("model"),
            prompt_version=data.get("prompt_version"),
        )


def is_record_key(key: str) -> bool:
    return key.endswith(RECORD)


def is_decision_key(key: str) -> bool:
    return key.endswith(DECISION)


def is_ai_key(key: str) -> bool:
    """A key the AI pipeline, its confirmation or `expand` wrote: not a question asked."""
    return key.endswith((RECORD, DECISION, EXTRACTED, PARTIAL))


def record_of(answer: Answer | None) -> Record | None:
    if answer is None or not isinstance(answer.value, Mapping):
        return None
    return Record.from_json(answer.value)


# --- what may be extracted ---


def _q14_note(artifact: FunnelArtifact) -> str:
    for note in artifact.raw["source"]["question_block_notes"]:
        if note["text"].startswith("Q14 se desglosa"):
            text: str = note["text"]
            return text
    raise FunnelArtifactError("v0.2 p. 4 lost the Q14 breakdown")


def _step_target(d: StepDef) -> Target:
    # "Ninguna de estas" (and an empty list) is a "No" to every option: only the
    # person gives it, on the question itself (R03; a DEFAULT the clinical lead
    # can change).
    options = tuple(o.key for o in d.options)
    units: tuple[str, ...] = ()
    if d.type == "duration":
        units = SLEEP_UNITS if d.id == "Q09" else DURATION_UNITS
    return Target(
        id=d.id,
        type=d.type,
        text=d.text,
        options=options if d.type in ("multi", "single") else (YES, NO),
        fields=tuple(f.key for f in d.fields),
        units=units,
        none_option=d.none_option,
    )


def all_targets(artifact: FunnelArtifact) -> tuple[Target, ...]:
    """Every question a narrative may answer, in the interview's order, then Q14's parts."""
    targets: list[Target] = []
    seen: set[str] = set()
    for d in artifact.steps:
        if d.stage not in ("core", *artifact.engine["branch_order"]):
            continue
        if d.id in NEVER_EXTRACTED or d.id in seen or d.safety or d.type == "info":
            continue
        # A branch question that repeats or follows from a core one is never
        # asked on its own (V-14), so it is not extracted on its own either.
        if d.same_as or d.inferred_from:
            continue
        seen.add(d.id)
        targets.append(_step_target(d))
    # Q14's breakdown (p. 4) is asked in Q14 itself; from the narrative only the
    # facts the rules and the Z1 summary read are taken (the flags below).
    note = _q14_note(artifact)
    for _, label in Q14_TEXT_PARTS:
        if label not in note:
            raise FunnelArtifactError(f"Q14 part {label!r} is not in the p. 4 note")
    q14 = artifact.step("Q14")
    for name in Q14_FLAGS:
        if name not in q14.extracts:
            raise FunnelArtifactError(f"Q14 flag {name!r} is not in the artifact's extracts")
        targets.append(Target(id=f"Q14.{name}", type="q14_flag", text=f"Q14: {name}"))
    return tuple(targets)


def targets(artifact: FunnelArtifact, settled: set[str]) -> tuple[Target, ...]:
    """What the model may still answer: nothing already answered, confirmed or removed."""
    return tuple(t for t in all_targets(artifact) if t.id not in settled)


# --- validating the model's output ---


def _value(target: Target, raw: Any, evidence: str) -> Any:
    """The engine value of a proposed item, or None if it does not fit the question."""
    t = target.type
    if t in ("q14_text", "free_text"):
        return evidence
    if t == "q14_flag":
        return True if raw == YES else None
    if t in ("yes_no", "yes_no_note"):
        return raw if raw in (YES, NO) else None
    if t == "single":
        return raw if raw in target.options else None
    if t == "multi":
        if not isinstance(raw, list) or not all(isinstance(k, str) for k in raw):
            return None
        if not raw or len(set(raw)) != len(raw) or not set(raw) <= set(target.options):
            return None
        return raw
    if t == "number":
        low, high = _NUMBER_LIMITS.get(target.id, (0, 200))
        ok = isinstance(raw, int) and not isinstance(raw, bool) and low <= raw <= high
        return raw if ok else None
    if t == "duration":
        if not isinstance(raw, Mapping) or set(raw) != {"amount", "unit"}:
            return None
        amount, unit = raw["amount"], raw["unit"]
        if isinstance(amount, bool) or not isinstance(amount, int | float):
            return None
        if not 0 < amount <= 1000 or unit not in target.units:
            return None
        number = int(amount) if float(amount).is_integer() else amount
        return {"value": number, "unit": unit}
    if t == "times":
        if not isinstance(raw, list) or not raw:
            return None
        times: dict[str, str] = {}
        for entry in raw:
            if not isinstance(entry, Mapping) or set(entry) != {"field", "time"}:
                return None
            name, time = entry["field"], entry["time"]
            if name not in target.fields or name in times or not isinstance(time, str):
                return None
            if not _TIME.match(time):
                return None
            times[name] = time
        return times
    return None


def validate(
    artifact: FunnelArtifact,
    raw_output: str,
    text: str,
    allowed: tuple[Target, ...],
    *,
    extract: bool = True,
) -> tuple[list[Item], dict[str, str], int] | None:
    """The model's JSON, checked: (items, risk, discarded), or None if out of schema.

    `text` is the exact text the model saw; every evidence must be a literal
    span of it. A malformed envelope or risk block discards the whole output
    (the call counts as failed); a malformed item discards only that item.
    """
    try:
        data = json.loads(raw_output)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict) or set(data) != {"items", "risk"}:
        return None
    risk = data["risk"]
    if not isinstance(risk, dict) or set(risk) != set(RISK_QUESTIONS):
        return None
    if not all(v in RISK_VALUES for v in risk.values()):
        return None
    if not isinstance(data["items"], list):
        return None
    by_id = {t.id: t for t in allowed}
    items: list[Item] = []
    discarded = 0
    seen: set[str] = set()
    for raw in data["items"] if extract else []:
        item = _item(raw, by_id, text)
        if item is None or item.id in seen:
            discarded += 1
            continue
        seen.add(item.id)
        items.append(item)
    if not extract:
        discarded = len(data["items"])
    return items, {q: str(risk[q]) for q in RISK_QUESTIONS}, discarded


def _item(raw: Any, by_id: Mapping[str, Target], text: str) -> Item | None:
    if not isinstance(raw, dict) or set(raw) != {"id", "value", "evidence"}:
        return None
    target = by_id.get(raw["id"]) if isinstance(raw["id"], str) else None
    evidence = raw["evidence"]
    if target is None or not isinstance(evidence, str):
        return None
    evidence = evidence.strip()
    if len(evidence) < MIN_EVIDENCE or evidence not in text:
        return None
    value = _value(target, raw["value"], evidence)
    if value is None:
        return None
    return Item(target.id, value, evidence)


# --- the person's decisions ---


def decisions_of(answer: Answer | None) -> dict[str, dict[str, Any]]:
    """`<source>#confirmacion`: item id → {"decision": …, "value"?: …}."""
    if answer is None or not isinstance(answer.value, Mapping):
        return {}
    return {k: dict(v) for k, v in answer.value.items() if isinstance(v, Mapping)}


def is_editable(target: Target) -> bool:
    """A question's value can be corrected on the screen. A Q14 part, and any
    text in the person's words (Q02, Q04's note, Q10), is kept or removed: a
    removed one is asked in its turn, where new words go through the
    identifier filter and the risk scan like any other answer."""
    return target.type not in ("q14_text", "q14_flag", "free_text", "yes_no_note")


def expand(answers: Mapping[str, Answer], artifact: FunnelArtifact) -> dict[str, Answer]:
    """The answers with each confirmed (or corrected) item inserted as an answer.

    Each item lands right after its confirmation, under its question's id, so
    every reading of the answers -- the next step, the cross-cutting exception,
    the rules, the Z1 summary -- sees it as if it had been answered then. A
    question answered directly keeps that answer. Q14's parts land together on
    `<source>#extraido` as `extracted` fields (what R07 and the catalogue read).
    Removed and pending items are left out: no rule ever reads them.

    Times given only in part (Q07, H2) land on `<id>#parcial`: the question is
    then asked for the missing ones only (p. 3: «Completar solo horarios que
    falten»), and the two parts are read as one answer.
    """
    if not any(is_decision_key(k) for k in answers):
        return dict(answers)
    out: dict[str, Answer] = {}
    for key, answer in answers.items():
        out[key] = answer
        if not is_decision_key(key):
            continue
        source = key.removesuffix(DECISION)
        record = record_of(answers.get(source + RECORD))
        if record is None:
            continue
        chosen = decisions_of(answer)
        q14: dict[str, Any] = {}
        for item in record.items:
            decision = chosen.get(item.id, {})
            kind = decision.get("decision")
            if kind not in (CONFIRMED, CORRECTED):
                continue
            value = decision["value"] if kind == CORRECTED else item.value
            if item.id.startswith("Q14."):
                q14[item.id.removeprefix("Q14.")] = value
                continue
            if isinstance(value, dict) and _partial_times(artifact, item.id, value):
                out[item.id + PARTIAL] = Answer(value=value, origin=ORIGIN_AI)
                continue
            if item.id in answers or item.id in out:
                continue
            out[item.id] = Answer(
                value=value,
                # Q04's note is the person's words about what changed.
                text=item.evidence if item.id == "Q04" and value == YES else None,
                origin=ORIGIN_CORRECTED if kind == CORRECTED else ORIGIN_AI,
                evidence=item.evidence,
            )
        if q14:
            out[source + EXTRACTED] = Answer(extracted=q14, origin=ORIGIN_AI)
    for key in [k for k in out if k.endswith(PARTIAL)]:
        base = key.removesuffix(PARTIAL)
        given = out.get(base)
        if given is not None and isinstance(given.value, dict):
            out[base] = replace(given, value={**out[key].value, **given.value})
    return out


def _partial_times(artifact: FunnelArtifact, step_id: str, value: Mapping[str, Any]) -> bool:
    definition = next((d for d in artifact.steps if d.id == step_id), None)
    if definition is None or definition.type != "times":
        return False
    return set(value) != {f.key for f in definition.fields}


__all__ = [
    "CONFIRMED",
    "CORRECTED",
    "DECISION",
    "EXTRACT_AFTER",
    "RECORD",
    "REMOVED",
    "SCREEN_ONLY",
    "Item",
    "Record",
    "Target",
    "all_targets",
    "decisions_of",
    "expand",
    "is_ai_key",
    "is_editable",
    "record_of",
    "targets",
    "validate",
]
