"""The embudo v0.2 interview: which step comes next (pure, deterministic).

Order (v0.2 p. 14, with Jesús's 18/10/2026 change, V-02):

    AGE → S1, S4 → Q01-Q18 → branches I → R → H → D → P → N (only the opened
    ones) → protection text → S1-S4 (asked, or confirmed if already answered)
    → Z1 → Z2

* Nothing already answered is asked again (V-14, D-29): a branch question that
  repeats a core one is inferred from it.
* The cross-cutting exception (pp. 1, 3, 9; D-01, D-37): a risk term in any free
  text, or a positive Q11, makes the matching safety question come next, at
  that moment. Only the person's answer to it raises an alert.
* "No lo sé" to AGE, Q03, Q05 or a closing safety question is asked once more
  (D-08); "prefiero no responder" is never pressed.
* A "Sí" to S1 or S4, anywhere, ends the interview (p. 10). So does AGE < 18
  (D-33) or an age still unknown after one clarification (R02).
* A "Sí" to S2, wherever it is asked, is followed at once by the driving
  warning and by a question on whether the person is in a safe place now
  (p. 10: "S2: primero advertencia; seguir solo si está en un lugar seguro").
  Anything but "Sí" pauses the interview. Both texts are drafts for the
  clinical lead (the phrase catalogue); v0.2 gives only the instruction.

Answers are stored by step key: the step id, plus "@stage" for the safety
questions that can be asked more than once (S1@start, S4@exception:Q06,
S2@ask_now:Q11, S1@confirm, S1@end) and "@aclarar" for a clarification.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact, StepDef
from morpheo.funnel.instruments import next_instrument_step
from morpheo.instruments.definitions import InstrumentRegistry

YES, NO = "si", "no"
NO_LO_SE, PREFIERO = "no_lo_se", "prefiero_no_responder"
SAFETY = ("S1", "S2", "S3", "S4")
# The steps after an S2 "Sí" (p. 10). Their text is a catalogue draft, filled
# by `render.question_text`, so the definitions carry none.
S2_WARNING, S2_SAFE = "S2_aviso", "S2_seguro"
S2_PAUSED = "S2_PAUSA"
_S2_WARNING_STEP = StepDef(S2_WARNING, "p. 10", "safety", "info", "", None)
_S2_SAFE_STEP = StepDef(S2_SAFE, "p. 10", "safety", "yes_no", "", None)


def special_step(step_id: str) -> StepDef | None:
    """The definition of a step that is not a v0.2 question (the S2 warning steps)."""
    return {S2_WARNING: _S2_WARNING_STEP, S2_SAFE: _S2_SAFE_STEP}.get(step_id)


@dataclass(frozen=True)
class Answer:
    """One answer, as the v0.2 data contract has it (p. 14).

    `value` is None when there is no answer; `absence` then says why. `text` is
    the person's own words (free text, or the note of a yes/no). `extracted`
    holds the fields the AI extracted from free text -- confirmed by the person
    in Z1 before any rule reads them (V-04).
    """

    value: Any = None
    absence: str | None = None
    text: str | None = None
    extracted: Mapping[str, Any] = field(default_factory=dict)
    confirmed: bool = True


@dataclass(frozen=True)
class Step:
    key: str
    definition: StepDef
    kind: str  # "ask" | "confirm" | "info"
    reason: str | None = None


def _fold(text: str) -> str:
    stripped = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in stripped if unicodedata.category(c) != "Mn")


def risk_hits(artifact: FunnelArtifact, text: str | None) -> dict[str, list[str]]:
    """Which safety questions a free text points at, and the terms that did it (D-01)."""
    if not text:
        return {}
    folded = _fold(text)
    hits: dict[str, list[str]] = {}
    for question, terms in artifact.engine["risk_terms"].items():
        if question == "default":
            continue
        found = [t for t in terms if re.search(rf"\b{re.escape(_fold(t))}", folded)]
        if found:
            hits[question] = found
    return hits


class Interview:
    """Read-only view of the answers given so far."""

    def __init__(self, artifact: FunnelArtifact, answers: Mapping[str, Answer]) -> None:
        self.a = artifact
        self.answers = answers

    # --- reading answers ---

    def answer(self, step_id: str) -> Answer | None:
        """The effective answer to a non-safety step: its clarification wins."""
        return self.answers.get(f"{step_id}@aclarar") or self.answers.get(step_id)

    def value(self, step_id: str) -> Any:
        given = self.answer(step_id)
        if given is not None:
            return given.value
        definition = self._first(step_id)
        if definition is not None and definition.same_as:
            return self.value(definition.same_as)
        if definition is not None and definition.inferred_from and self._inferred(definition):
            return YES
        return None

    def _first(self, step_id: str) -> StepDef | None:
        return next((d for d in self.a.steps if d.id == step_id), None)

    def _inferred(self, definition: StepDef) -> bool:
        rule = definition.inferred_from or {}
        source = self.value(rule["question"])
        if "equals" in rule:
            return bool(source == rule["equals"])
        chosen = source if isinstance(source, list) else [source]
        return any(option in chosen for option in rule["any_of"])

    def safety(self, question: str) -> str | None:
        """Any "Sí" counts (conservative); else the latest answer given."""
        values = [
            ans.value
            for key, ans in self.answers.items()
            if key.split("@")[0] == question and not key.endswith("@confirm")
        ]
        if YES in values:
            return YES
        known = [v for v in values if v is not None]
        return known[-1] if known else None

    def safety_asked(self, question: str) -> bool:
        return any(key.split("@")[0] == question for key in self.answers)

    def extracted(self, name: str) -> Any:
        for ans in self.answers.values():
            if ans.confirmed and name in ans.extracted:
                return ans.extracted[name]
        return None

    # --- stopping ---

    def stopped(self) -> str | None:
        if self.safety("S1") == YES:
            return "S1"
        if self.safety("S4") == YES:
            return "S4"
        safe = self.answers.get(S2_SAFE)
        if safe is not None and safe.value != YES:
            return S2_PAUSED
        age = self.answer("AGE")
        if age is not None and isinstance(age.value, int) and age.value < 18:
            return "AGE_MENOR"
        if (
            age is not None
            and age.value is None
            and ("AGE@aclarar" in self.answers or age.absence == PREFIERO)
        ):
            return "AGE_DESCONOCIDA"
        return None

    # --- branch opening (D-09 to D-12) ---

    def branch_open(self, branch: str) -> bool:
        v = self.value
        if branch == "I":
            q08 = v("Q08")
            return q08 is None or (isinstance(q08, list) and len(q08) > 0)
        if branch == "R":
            q15 = v("Q15")
            return q15 is None or (isinstance(q15, list) and len(q15) > 0)
        if branch == "H":
            return (
                v("Q13") in (NO, None)
                or v("Q18") == YES
                or bool(self.extracted("horario_distinto"))
            )
        if branch == "D":
            return v("Q11") in ("dormido_sin_querer", "ambas", None)
        if branch == "P":
            return v("Q16") in (YES, None)
        if branch == "N":
            return v("Q17") in (YES, None)
        raise KeyError(branch)

    def _branch_stops_before(self, definition: StepDef) -> bool:
        """The lateral exits of branch I (p. 5): a "No" to I1 or I2 ends it."""
        if definition.stage != "I":
            return False
        order = ["I1", "I2", "I3", "I4"]
        earlier = order[: order.index(definition.id)]
        return any(self.value(prior) == NO for prior in earlier if prior in ("I1", "I2"))

    def chronic_derivable(self) -> bool:
        q03, q05 = self.value("Q03"), self.value("Q05")
        return isinstance(q03, dict) and isinstance(q05, int)

    def insomnia_pattern(self) -> bool:
        """I6 (p. 5): I1-I3 are "Sí" -- I3 derived from Q03/Q05 when it was not asked."""
        if not self.branch_open("I") or self.value("I1") != YES or self.value("I2") != YES:
            return False
        return self.value("I3") == YES or chronic_from_core(self) is True


def _days(duration: Mapping[str, Any]) -> float:
    per = {"dias": 1, "semanas": 7, "meses": 30.4, "años": 365, "horas": 1 / 24}
    return float(duration["value"]) * per[duration["unit"]]


def chronic_from_core(iv: Interview) -> bool | None:
    q03, q05 = iv.value("Q03"), iv.value("Q05")
    if not isinstance(q03, dict) or not isinstance(q05, int):
        return None
    return q05 >= 3 and _days(q03) >= 90


def next_step(
    artifact: FunnelArtifact,
    answers: Mapping[str, Answer],
    instruments: InstrumentRegistry | None = None,
) -> Step | None:
    iv = Interview(artifact, answers)
    if iv.stopped():
        return None

    # 0. After an S2 "Sí": first the warning, then continue only if safe (p. 10).
    if iv.safety("S2") == YES:
        if S2_WARNING not in answers:
            return Step(S2_WARNING, _S2_WARNING_STEP, "info", "p. 10: S2 = Sí, primero advertencia")
        if S2_SAFE not in answers:
            return Step(
                S2_SAFE, _S2_SAFE_STEP, "ask", "p. 10: seguir solo si está en un lugar seguro"
            )

    def already_settled(question: str) -> bool:
        # A "Sí" needs no second asking. S1/S4 are asked again when a later
        # answer points at them even after a "No" at the start (the situation
        # may have changed); S2 once asked is not repeated (V-14).
        if iv.safety(question) == YES:
            return True
        return question == "S2" and iv.safety_asked("S2")

    # 1. The cross-cutting exception, in the order the answers were given.
    for key, ans in answers.items():
        base = key.split("@")[0]
        definition = iv._first(base)
        if definition is None:
            continue
        if definition.risk_scan:
            for question in risk_hits(artifact, ans.text if ans.text else None):
                ask = f"{question}@exception:{base}"
                if ask not in answers and not already_settled(question):
                    terms = ", ".join(risk_hits(artifact, ans.text)[question])
                    return Step(
                        ask,
                        artifact.step(question, "end"),
                        "ask",
                        f"excepción: «{terms}» en {base}",
                    )
        if definition.then_ask_now and ans.value in definition.then_ask_now["when"]:
            for question in definition.then_ask_now["ask"]:
                ask = f"{question}@ask_now:{base}"
                if ask not in answers and not already_settled(question):
                    reason = f"{definition.then_ask_now['default']}: {base} = {ans.value}"
                    return Step(ask, artifact.step(question, "end"), "ask", reason)

    # 2. The fixed order; an instrument due at the end of its branch comes
    # before the first step of a later stage.
    stage_order = ["start", "core", *artifact.engine["branch_order"], "end"]
    for definition in artifact.steps:
        due = next_instrument_step(instruments, iv, definition.stage, stage_order)
        if due is not None:
            instrument_step, reason = due
            kind = "instrument_intro" if instrument_step.id.endswith("#intro") else "ask"
            return Step(instrument_step.id, instrument_step, kind, reason)
        step = _pending(iv, definition)
        if step is not None:
            return step
    return None


def _pending(iv: Interview, d: StepDef) -> Step | None:
    answers = iv.answers
    if d.safety and d.stage == "start":
        key = f"{d.id}@start"
        return None if key in answers else Step(key, d, "ask")
    if d.safety and d.stage == "end":
        return _closing_safety(iv, d)
    if d.stage in iv.a.engine["branch_order"]:
        if not iv.branch_open(d.stage) or iv._branch_stops_before(d):
            return None
        if (d.same_as or d.inferred_from) and iv.value(d.id) is not None:
            return None
        if d.id == "I3" and iv.chronic_derivable():
            return None
    if d.type == "info":
        return None if d.id in answers else Step(d.id, d, "info")
    given = answers.get(d.id)
    if given is None:
        return Step(d.id, d, "ask")
    clarify = d.clarify_once or d.id == "AGE"
    if clarify and given.absence == NO_LO_SE and f"{d.id}@aclarar" not in answers:
        return Step(f"{d.id}@aclarar", d, "ask", "D-08: una sola aclaración")
    return None


def _closing_safety(iv: Interview, d: StepDef) -> Step | None:
    answers = iv.answers
    end_key = f"{d.id}@end"
    if iv.safety_asked(d.id) and end_key not in answers:
        confirm = f"{d.id}@confirm"
        if confirm not in answers:
            return Step(confirm, d, "confirm", "V-02: ya respondida; se confirma (p. 9)")
        if answers[confirm].value != "ha_cambiado":
            return None
    if end_key not in answers:
        return Step(end_key, d, "ask")
    if answers[end_key].absence == NO_LO_SE and f"{end_key}@aclarar" not in answers:
        return Step(f"{end_key}@aclarar", d, "ask", "D-08: una sola aclaración")
    return None
