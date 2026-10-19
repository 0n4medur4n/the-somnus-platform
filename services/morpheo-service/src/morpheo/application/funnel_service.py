"""The v2 interview service: an answer in, the next step (or the result) out.

The engine (`morpheo.funnel`) decides every step; this service only stores the
answers in the order given, accepts an answer solely for the step the engine is
serving now, checks it against that step's answer type, and turns the engine's
step and result into the contract DTOs. Nothing here decides order, branches,
rules or wording. Answers are health data: never logged.
"""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.orm import Session

from morpheo.domain.identifying_data import FREE_TEXT_MAX_LENGTH, find_identifying_data
from morpheo.funnel.artifact import FunnelArtifact, StepDef, funnel_artifact
from morpheo.funnel.catalogue import Catalogue, funnel_catalogue
from morpheo.funnel.display import answer_label
from morpheo.funnel.instruments import InstrumentOutcome, intro_step, item_steps
from morpheo.funnel.interview import (
    NO,
    S2_PAUSED,
    YES,
    Answer,
    Interview,
    Step,
    next_step,
    special_step,
)
from morpheo.funnel.render import question_text
from morpheo.funnel.rules import FunnelResult, evaluate
from morpheo.infrastructure.models import FunnelAnswer, FunnelSession
from morpheo.instruments.definitions import InstrumentRegistry
from morpheo.repositories.funnel import FunnelRepository
from morpheo.schemas.funnel import (
    FunnelAnswerRequestDTO,
    FunnelDurationDTO,
    FunnelHistoryItemDTO,
    FunnelInstrumentDTO,
    FunnelOptionDTO,
    FunnelOrientationDTO,
    FunnelPhase,
    FunnelResultDTO,
    FunnelResultPanelDTO,
    FunnelStateDTO,
    FunnelStatus,
    FunnelStepDTO,
    FunnelStepInstrumentDTO,
    FunnelStepPanelDTO,
    FunnelTextDTO,
)

DURATION_UNITS = ["dias", "semanas", "meses", "años"]
SLEEP_UNITS = ["horas"]
_TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_NUMBER_LIMITS = {"AGE": (0, 120), "Q05": (0, 7)}


class AnswerRejected(ValueError):
    """The answer does not fit the step being served (the code says why)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _round(number: float) -> int | float:
    return int(number) if float(number).is_integer() else number


class FunnelService:
    def __init__(
        self,
        session: Session,
        registry: InstrumentRegistry | None = None,
        artifact: FunnelArtifact | None = None,
        catalogue: Catalogue | None = None,
    ) -> None:
        self._repo = FunnelRepository(session)
        self._registry = registry
        self._a = artifact or funnel_artifact()
        self._c = catalogue or funnel_catalogue()

    # --- the four moves ---

    def create(self, owner_id: str | None) -> FunnelStateDTO:
        session_id = self._repo.create(owner_id, self._a.content_version, self._a.rules_version)
        state = self.state(session_id, owner_id)
        assert state is not None
        return state

    def state(self, session_id: str, actor_id: str | None) -> FunnelStateDTO | None:
        session = self._session(session_id, actor_id)
        if session is None:
            return None
        return self._state(session, self._answers(session_id))

    def answer(
        self, session_id: str, actor_id: str | None, body: FunnelAnswerRequestDTO
    ) -> FunnelStateDTO | None:
        session = self._session(session_id, actor_id)
        if session is None:
            return None
        answers = self._answers(session_id)
        step = next_step(self._a, answers, self._registry)
        if step is None or body.key != step.key:
            raise AnswerRejected("not_the_current_step")
        value, absence, text = self._validate(step, body)
        value_json = None if value is None else json.dumps(value, ensure_ascii=False)
        self._repo.add_answer(session_id, step.key, value_json, absence, text)
        answers = self._answers(session_id)
        self._settle(session, answers)
        return self._state(session, answers)

    def back(self, session_id: str, actor_id: str | None) -> FunnelStateDTO | None:
        session = self._session(session_id, actor_id)
        if session is None:
            return None
        rows = self._repo.answers(session_id)
        if rows:
            self._repo.delete_from(session_id, rows[-1].id)
        return self._reopen(session)

    def rewind(self, session_id: str, actor_id: str | None, key: str) -> FunnelStateDTO | None:
        """Z1: "No" -- go back to one answer to change it; what followed it goes too."""
        session = self._session(session_id, actor_id)
        if session is None:
            return None
        row = next((r for r in self._repo.answers(session_id) if r.step_key == key), None)
        if row is None:
            raise AnswerRejected("not_answered")
        self._repo.delete_from(session_id, row.id)
        return self._reopen(session)

    # --- reading and writing answers ---

    def _session(self, session_id: str, actor_id: str | None) -> FunnelSession | None:
        session = self._repo.get(session_id)
        # Someone's own interview reads, to anyone else, exactly like one that
        # does not exist.
        if session is None or (session.owner_id is not None and session.owner_id != actor_id):
            return None
        return session

    def _answers(self, session_id: str) -> dict[str, Answer]:
        return {row.step_key: self._to_answer(row) for row in self._repo.answers(session_id)}

    @staticmethod
    def _to_answer(row: FunnelAnswer) -> Answer:
        value: Any = None if row.value_json is None else json.loads(row.value_json)
        if value is None and row.absence is None and row.text is not None:
            value = row.text  # a free-text answer: its value is the text
        return Answer(value=value, absence=row.absence, text=row.text)

    def _settle(self, session: FunnelSession, answers: dict[str, Answer]) -> None:
        if next_step(self._a, answers, self._registry) is not None:
            return
        stopped = Interview(self._a, answers).stopped()
        status = "paused" if stopped == S2_PAUSED else "stopped" if stopped else "finished"
        self._repo.set_status(session.id, status)

    def _reopen(self, session: FunnelSession) -> FunnelStateDTO:
        if session.status != "open":
            self._repo.set_status(session.id, "open")
        answers = self._answers(session.id)
        self._settle(session, answers)
        return self._state(session, answers)

    def _validate(
        self, step: Step, body: FunnelAnswerRequestDTO
    ) -> tuple[Any, str | None, str | None]:
        d, kind = step.definition, step.kind
        if body.absence is not None:
            if kind == "info":
                raise AnswerRejected("absence_not_allowed")
            return None, body.absence, None
        value: Any = body.value
        note: str | None = None
        if body.text is not None:
            if d.type != "yes_no_note":
                raise AnswerRejected("note_not_allowed")
            note = self._free_text(body.text)
        if kind == "info":
            if value != "visto":
                raise AnswerRejected("invalid_value")
        elif kind == "confirm":
            if value not in ("sigue_igual", "ha_cambiado"):
                raise AnswerRejected("invalid_value")
        elif kind == "instrument_intro" or d.type in ("yes_no", "yes_no_note"):
            if value not in (YES, NO):
                raise AnswerRejected("invalid_value")
        elif d.type == "number":
            low, high = _NUMBER_LIMITS.get(d.id, (0, 200))
            if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
                raise AnswerRejected("invalid_value")
        elif d.type == "free_text":
            if not isinstance(value, str):
                raise AnswerRejected("invalid_value")
            return None, None, self._free_text(value)
        elif d.type == "duration":
            if not isinstance(value, FunnelDurationDTO) or value.unit not in self._units(d):
                raise AnswerRejected("invalid_value")
            value = {"value": _round(value.value), "unit": value.unit}
        elif d.type == "times":
            keys = {f.key for f in d.fields}
            if (
                not isinstance(value, dict)
                or set(value) != keys
                or not all(_TIME.match(t) for t in value.values())
            ):
                raise AnswerRejected("invalid_value")
        elif d.type == "multi":
            keys = {o.key for o in d.options}
            if (
                not isinstance(value, list)
                or len(set(value)) != len(value)
                or not set(value) <= keys
                or (not value and not d.none_option)
            ):
                raise AnswerRejected("invalid_value")
        elif d.type == "single":
            keys = {o.key for o in d.options} | ({"ninguna"} if d.none_option else set())
            if value not in keys:
                raise AnswerRejected("invalid_value")
        return value, None, note

    @staticmethod
    def _free_text(text: str) -> str:
        cleaned = text.strip()
        if not cleaned or len(cleaned) > FREE_TEXT_MAX_LENGTH:
            raise AnswerRejected("invalid_value")
        if find_identifying_data(cleaned):
            raise AnswerRejected("identifying_data")
        return cleaned

    @staticmethod
    def _units(d: StepDef) -> list[str]:
        return SLEEP_UNITS if d.id == "Q09" else DURATION_UNITS

    # --- building the contract ---

    def _definition_for(self, key: str) -> tuple[StepDef | None, str]:
        """The step definition behind an answer key, and the kind it was asked as."""
        base = key.split("@")[0]
        kind = "confirm" if key.endswith("@confirm") else "ask"
        if "#" in base and self._registry is not None:
            code = base.split("#")[0]
            instrument = self._registry.definitions.get(code)
            if instrument is not None:
                intro = intro_step(instrument)
                if base == intro.id:
                    return intro, "instrument_intro"
                return next((s for s in item_steps(instrument) if s.id == base), None), "ask"
        special = special_step(base)
        if special is not None:
            return special, "info" if special.type == "info" else "ask"
        definition = next((s for s in self._a.steps if s.id == base), None)
        if definition is not None and definition.type == "info":
            kind = "info"
        return definition, kind

    def _branches_opened(self, keys: list[str]) -> list[str]:
        order: list[str] = self._a.engine["branch_order"]
        stages = set()
        for key in keys:
            definition, _ = self._definition_for(key)
            if definition is not None:
                stages.add(definition.stage)
        return [b for b in order if b in stages]

    @staticmethod
    def _instrument(o: InstrumentOutcome) -> FunnelInstrumentDTO:
        return FunnelInstrumentDTO(
            code=o.code,
            name=o.name,
            status=o.status,
            total=o.total,
            band=o.band,
            placement=o.placement,
        )

    def _phase(self, step: Step) -> FunnelPhase:
        stage = step.definition.stage
        if stage.startswith("instrument:"):
            return "instrument"
        if stage == "start":
            return "start"
        if stage == "core":
            return "story"
        if stage in self._a.engine["branch_order"]:
            return "branches"
        if step.definition.id in ("Z1", "Z2"):
            return "closing"
        return "protection"

    def _step(self, step: Step, answers: dict[str, Answer], iv: Interview) -> FunnelStepDTO:
        d = step.definition
        text, _ = question_text(d, iv, self._c)
        instrument = None
        if d.source.startswith("instrument:"):
            instrument = FunnelStepInstrumentDTO(code=d.source.split(":", 1)[1], name=d.note or "")
        provisional = evaluate(self._a, answers, self._registry)
        panel = FunnelStepPanelDTO(
            reason=step.reason,
            source=d.source,
            branches_opened=self._branches_opened([*answers, step.key]),
            rules_fired=list(provisional.rule_ids),
            main_action=provisional.accion_principal,
            phrase_ids=list(provisional.phrase_ids),
            instruments=[self._instrument(o) for o in provisional.instruments],
        )
        return FunnelStepDTO(
            key=step.key,
            question_id=d.id,
            kind=step.kind,
            type=d.type,
            text=text,
            note=None,
            options=[FunnelOptionDTO(key=o.key, label=o.label) for o in d.options],
            fields=[FunnelOptionDTO(key=f.key, label=f.label) for f in d.fields],
            none_option=d.none_option,
            unit=d.unit,
            units=self._units(d) if d.type == "duration" else [],
            allow_absence=step.kind != "info",
            instrument=instrument,
            phase=self._phase(step),
            answered_count=len(answers),
            panel=panel,
        )

    def _result(self, result: FunnelResult, answers: dict[str, Answer]) -> FunnelResultDTO:
        return FunnelResultDTO(
            stopped_by=result.stopped_by,
            alerts=list(result.alerts),
            main_action=result.accion_principal,
            associated_actions=list(result.acciones_asociadas),
            test_to_consider=result.prueba_a_valorar,
            texts=[FunnelTextDTO(template=t, text=x) for t, x in result.texts],
            instruments=[
                self._instrument(o) for o in result.instruments if o.status == "completed"
            ],
            instruments_note=result.instruments_note,
            content_version=self._a.content_version,
            rules_version=result.version_reglas,
            panel=FunnelResultPanelDTO(
                rule_ids=list(result.rule_ids),
                trace=list(result.trace),
                flags=list(result.flags),
                pending_data=list(result.datos_pendientes),
                phrase_ids=list(result.phrase_ids),
                branches_opened=self._branches_opened(list(answers)),
                orientations=[
                    FunnelOrientationDTO(
                        category=o.category, template=o.template, rule=o.rule, why=o.why
                    )
                    for o in result.orientations
                ],
                instruments=[self._instrument(o) for o in result.instruments],
            ),
        )

    def _history(self, answers: dict[str, Answer], iv: Interview) -> list[FunnelHistoryItemDTO]:
        items: list[FunnelHistoryItemDTO] = []
        for key, answer in answers.items():
            definition, kind = self._definition_for(key)
            if definition is None or kind == "info":
                continue
            question, _ = question_text(definition, iv, self._c)
            items.append(
                FunnelHistoryItemDTO(
                    key=key, question=question, answer=answer_label(answer, definition, kind)
                )
            )
        return items

    def _state(self, session: FunnelSession, answers: dict[str, Answer]) -> FunnelStateDTO:
        iv = Interview(self._a, answers)
        step = next_step(self._a, answers, self._registry)
        status: FunnelStatus = "open"
        result = None
        if step is None:
            stopped = iv.stopped()
            status = "paused" if stopped == S2_PAUSED else "stopped" if stopped else "finished"
            result = self._result(evaluate(self._a, answers, self._registry), answers)
        return FunnelStateDTO(
            session_id=session.id,
            status=status,
            step=None if step is None else self._step(step, answers, iv),
            result=result,
            history=self._history(answers, iv),
            owned=session.owner_id is not None,
        )
