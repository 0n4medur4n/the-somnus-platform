"""Where the validated instruments enter the v0.2 interview, and their outcome.

Placement (owner and clinical lead, 19/10/2026):

* ISI -- v0.2 p. 5, I6: "Proponer TCC-I; diario e ISI como apoyo, sin retrasar
  la atención". Offered at the end of branch I when I1-I3 are "Sí" (I3 may be
  derived from Q03/Q05, as R04 does).
* Epworth -- v0.2 p. 14 ("Epworth para somnolencia"): offered at the end of
  branch D when it opens. A default the clinical lead can change (DEFAULT_MARK).
* STOP-Bang -- v0.2 p. 14 ("STOP-Bang/STOP si el equipo elige un cribado
  respiratorio"): offered at the end of branch R when it opens. Also a
  default (DEFAULT_MARK).

Always optional: the first screen shows the official instructions and the
person may answer or skip it. Items are shown word for word from the official
file. A score is recorded for the clinician and the team panel; it never
feeds R01-R08 ("Ninguna escala confirma apnea ni sustituye la entrevista").
An instrument whose official file has not arrived is skipped and reported as
pending.

Answer keys: "<CODE>#intro" ("si" to answer, "no" to skip) and
"<CODE>#<item id>" (the option value, as a string).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from morpheo.funnel.artifact import Option, StepDef
from morpheo.instruments.definitions import InstrumentDefinition, InstrumentRegistry
from morpheo.instruments.scoring import score

YES, NO = "si", "no"
PENDING_FILE = "pendiente: archivo oficial de Jesús"


@dataclass(frozen=True)
class Placement:
    after_stage: str
    source: str
    default: bool


@dataclass(frozen=True)
class InstrumentOutcome:
    code: str
    name: str | None
    status: str  # completed | declined | incomplete | pending_file
    total: int | None
    band: str | None
    version: str | None
    official_sha256: str | None
    placement: str


PLACEMENT: dict[str, Placement] = {
    "ISI": Placement(
        "I",
        "v0.2 p. 5, I6: «Proponer TCC-I; diario e ISI como apoyo, sin retrasar la atención»",
        default=False,
    ),
    "ESS": Placement(
        "D",
        "v0.2 p. 14: «Epworth para somnolencia» (al abrirse la rama D)",
        default=True,
    ),
    "STOP-BANG": Placement(
        "R",
        "v0.2 p. 14: «STOP-Bang/STOP si el equipo elige un cribado respiratorio»"
        " (al abrirse la rama R)",
        default=True,
    ),
}
DEFAULT_MARK = "DEFAULT \N{EN DASH} Jesús puede cambiarlo"


class InterviewLike(Protocol):
    @property
    def answers(self) -> Mapping[str, object]: ...

    def branch_open(self, branch: str) -> bool: ...

    def insomnia_pattern(self) -> bool: ...


def _is_due(code: str, iv: InterviewLike) -> bool:
    if code == "ISI":
        return iv.insomnia_pattern()
    if code == "ESS":
        return iv.branch_open("D")
    return iv.branch_open("R")


def intro_step(definition: InstrumentDefinition) -> StepDef:
    return StepDef(
        id=f"{definition.code}#intro",
        source=f"instrument:{definition.code}",
        stage=f"instrument:{definition.code}",
        type="instrument_intro",
        text=definition.instructions,
        note=definition.name,
    )


def item_steps(definition: InstrumentDefinition) -> list[StepDef]:
    return [
        StepDef(
            id=f"{definition.code}#{item.id}",
            source=f"instrument:{definition.code}",
            stage=f"instrument:{definition.code}",
            type="single",
            text=item.text,
            note=definition.name,
            options=tuple(Option(str(o.value), o.label) for o in item.options),
        )
        for item in definition.items
    ]


def _finished(definition: InstrumentDefinition, answers: Mapping[str, object]) -> bool:
    intro = answers.get(f"{definition.code}#intro")
    if intro is None:
        return False
    if getattr(intro, "value", None) != YES:
        return True
    return all(f"{definition.code}#{item.id}" in answers for item in definition.items)


def next_instrument_step(
    registry: InstrumentRegistry | None,
    iv: InterviewLike,
    stage: str,
    stage_order: list[str],
) -> tuple[StepDef, str] | None:
    """The next instrument screen due before a step of `stage`, with its reason."""
    if registry is None:
        return None
    for code, placement in PLACEMENT.items():
        definition = registry.definitions.get(code)
        if definition is None or _finished(definition, iv.answers):
            continue
        if stage_order.index(stage) <= stage_order.index(placement.after_stage):
            continue
        if not _is_due(code, iv):
            continue
        reason = placement.source + (f" · {DEFAULT_MARK}" if placement.default else "")
        if f"{code}#intro" not in iv.answers:
            return intro_step(definition), reason
        for step in item_steps(definition):
            if step.id not in iv.answers:
                return step, reason
    return None


def outcomes(
    registry: InstrumentRegistry | None,
    iv: InterviewLike,
    value_of: Callable[[str], object],
) -> tuple[InstrumentOutcome, ...]:
    """What happened to each instrument this interview would offer."""
    if registry is None or not registry.enabled:
        return ()
    out: list[InstrumentOutcome] = []
    for code, placement in PLACEMENT.items():
        if not _is_due(code, iv):
            continue
        definition = registry.definitions.get(code)
        if definition is None:
            if code in registry.pending:
                out.append(
                    InstrumentOutcome(
                        code, None, "pending_file", None, None, None, None, placement.source
                    )
                )
            continue
        intro = value_of(f"{code}#intro")
        if intro is None:
            continue  # stopped before it was offered
        if intro != YES:
            status, total, band = "declined", None, None
        else:
            responses: dict[str, int | None] = {}
            for item in definition.items:
                raw = value_of(f"{code}#{item.id}")
                responses[item.id] = int(raw) if isinstance(raw, str) and raw.isdigit() else None
            result = score(definition, responses)
            status = "completed" if result.complete else "incomplete"
            total, band = result.total, result.band
        out.append(
            InstrumentOutcome(
                code,
                definition.name,
                status,
                total,
                band,
                definition.version,
                definition.official_sha256,
                placement.source,
            )
        )
    return tuple(out)
