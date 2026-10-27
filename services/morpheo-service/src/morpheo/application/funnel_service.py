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

from morpheo.ai.pipeline import AiExtractor
from morpheo.domain.identifying_data import FREE_TEXT_MAX_LENGTH, find_identifying_data
from morpheo.funnel import extraction
from morpheo.funnel.ai_steps import CONFIRM_KIND, confirm_step
from morpheo.funnel.artifact import FunnelArtifact, StepDef, funnel_artifact
from morpheo.funnel.catalogue import Catalogue, funnel_catalogue
from morpheo.funnel.display import answer_label
from morpheo.funnel.informe import Informe, InformeArtifact, build
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
    FunnelAiItemPanelDTO,
    FunnelAiPanelDTO,
    FunnelAiRiskDTO,
    FunnelAnswerRequestDTO,
    FunnelDurationDTO,
    FunnelExtractionDTO,
    FunnelExtractionItemDTO,
    FunnelHistoryItemDTO,
    FunnelInstrumentDTO,
    FunnelOptionDTO,
    FunnelOrientationDTO,
    FunnelPhase,
    FunnelReportAnswerDTO,
    FunnelReportDTO,
    FunnelReportFlagDTO,
    FunnelReportGroundingDTO,
    FunnelReportHelpDTO,
    FunnelReportProfessionalDTO,
    FunnelReportResourceDTO,
    FunnelReportSafetyDTO,
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
        ai: AiExtractor | None = None,
        informe: InformeArtifact | None = None,
    ) -> None:
        self._repo = FunnelRepository(session)
        self._registry = registry
        self._ai = ai
        self._informe = informe
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
        if step.kind == CONFIRM_KIND:
            value, absence, text = self._decisions(step, answers, body), None, None
        else:
            value, absence, text = self._validate(step, body)
        value_json = None if value is None else json.dumps(value, ensure_ascii=False)
        self._repo.add_answer(session_id, step.key, value_json, absence, text)
        answers = self._answers(session_id)
        if self._ai is not None and text is not None and step.kind == "ask":
            # v0.2 p. 14: extract from the person's words, and screen them for
            # risk. A failed call still leaves a record: the interview then
            # asks every question and the safety fallback.
            call = self._ai.process(self._a, answers, step.key, text)
            if call is not None:
                record = json.dumps(call.record.to_json(), ensure_ascii=False)
                self._repo.add_answer(session_id, step.key + extraction.RECORD, record, None, None)
                answers = self._answers(session_id)
        self._settle(session, answers)
        return self._state(session, answers)

    def back(self, session_id: str, actor_id: str | None) -> FunnelStateDTO | None:
        session = self._session(session_id, actor_id)
        if session is None:
            return None
        # The person's last answer goes, with the AI record written after it.
        rows = [
            r for r in self._repo.answers(session_id) if not extraction.is_record_key(r.step_key)
        ]
        if rows:
            self._repo.delete_from(session_id, rows[-1].id)
        return self._reopen(session)

    def rewind(self, session_id: str, actor_id: str | None, key: str) -> FunnelStateDTO | None:
        """Z1: "No" -- go back to one answer to change it; what followed it goes too."""
        session = self._session(session_id, actor_id)
        if session is None:
            return None
        rows = self._repo.answers(session_id)
        row = next((r for r in rows if r.step_key == key), None)
        if row is None:
            # An answer confirmed from the narrative: back to its confirmation.
            row = next((r for r in rows if self._confirms(r, key)), None)
        if row is None:
            raise AnswerRejected("not_answered")
        self._repo.delete_from(session_id, row.id)
        return self._reopen(session)

    @staticmethod
    def _confirms(row: FunnelAnswer, item_id: str) -> bool:
        if not extraction.is_decision_key(row.step_key) or row.value_json is None:
            return False
        decision = json.loads(row.value_json).get(item_id, {})
        return decision.get("decision") in (extraction.CONFIRMED, extraction.CORRECTED)

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

    def _decisions(
        self, step: Step, answers: dict[str, Answer], body: FunnelAnswerRequestDTO
    ) -> dict[str, dict[str, Any]]:
        """The confirmation screen: one decision per proposed item, nothing else."""
        record = extraction.record_of(answers.get(self._record_key(step.key)))
        if record is None or body.decisions is None:
            raise AnswerRejected("invalid_value")
        given = {d.id: d for d in body.decisions}
        if len(given) != len(body.decisions) or set(given) != {i.id for i in record.items}:
            raise AnswerRejected("invalid_value")
        targets = {t.id: t for t in extraction.all_targets(self._a)}
        out: dict[str, dict[str, Any]] = {}
        for item_id, decision in given.items():
            entry: dict[str, Any] = {"decision": decision.decision}
            if decision.decision == extraction.CORRECTED:
                target = targets[item_id]
                if not extraction.is_editable(target) or decision.value is None:
                    raise AnswerRejected("invalid_value")
                corrected, _, _ = self._validate(
                    Step(item_id, self._a.step(item_id), "ask"),
                    FunnelAnswerRequestDTO(key=item_id, value=decision.value),
                )
                entry["value"] = corrected
            elif decision.value is not None:
                raise AnswerRejected("invalid_value")
            out[item_id] = entry
        return out

    @staticmethod
    def _record_key(decision_key: str) -> str:
        return decision_key.removesuffix(extraction.DECISION) + extraction.RECORD

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
        if extraction.is_decision_key(key):
            return confirm_step("core"), CONFIRM_KIND
        if extraction.is_ai_key(key):
            return None, "ask"
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

    def _phase(self, step: Step, answers: dict[str, Answer]) -> FunnelPhase:
        # A safety question asked at that moment (an exception, Q11's S2, and the
        # S2 warning that follows) belongs to where the person is, not to the
        # closing protection block: the progress bar does not jump ahead.
        source = self._raised_by(step.key, answers)
        if source is not None:
            definition = next((d for d in self._a.steps if d.id == source), None)
            if definition is not None:
                return self._phase(Step(source, definition, "ask"), {})
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

    @staticmethod
    def _raised_by(key: str, answers: dict[str, Answer]) -> str | None:
        """The answer that raised a safety question at that moment, if it was one."""
        for marker in ("@exception:", "@ask_now:"):
            if marker in key:
                return key.split(marker, 1)[1].split("@")[0]
        if key in ("S2_aviso", "S2_seguro"):
            raised = [k for k in answers if k.startswith("S2@") and ":" in k]
            if raised:
                return raised[-1].split(":", 1)[1].split("@")[0]
        return None

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
            branches_opened=self._branches_opened([*iv.answers, step.key]),
            rules_fired=list(provisional.rule_ids),
            main_action=provisional.accion_principal,
            phrase_ids=list(provisional.phrase_ids),
            instruments=[self._instrument(o) for o in provisional.instruments],
            ai=self._ai_panel(answers),
        )
        return FunnelStepDTO(
            key=step.key,
            question_id=d.id,
            kind=step.kind,
            type=d.type,
            text=text,
            # The confirmation screen's closing question («¿Es correcto?»).
            note=d.note if step.kind == CONFIRM_KIND else None,
            options=[FunnelOptionDTO(key=o.key, label=o.label) for o in d.options],
            fields=[FunnelOptionDTO(key=f.key, label=f.label) for f in d.fields],
            none_option=d.none_option,
            unit=d.unit,
            units=self._units(d) if d.type == "duration" else [],
            allow_absence=step.kind != "info",
            instrument=instrument,
            phase=self._phase(step, answers),
            answered_count=sum(1 for k in answers if not extraction.is_ai_key(k)),
            extraction=self._extraction(step, answers) if step.kind == CONFIRM_KIND else None,
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
            report=self._report(result, answers),
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
                ai=self._ai_panel(answers),
            ),
        )

    def _report(self, result: FunnelResult, answers: dict[str, Answer]) -> FunnelReportDTO | None:
        """The one-page report, when REPORT_V3_ENABLED (and the texts are signed)."""
        if self._informe is None:
            return None
        built = build(self._a, self._c, self._informe, Interview(self._a, answers), result)
        return None if built is None else self._report_dto(built)

    @staticmethod
    def _report_dto(report: Informe) -> FunnelReportDTO:
        pro = report.professional
        return FunnelReportDTO(
            layout="urgent" if report.layout == "urgent" else "standard",
            headline=list(report.headline),
            secondary=list(report.secondary),
            summary=report.summary,
            steps=list(report.steps),
            help=FunnelReportHelpDTO(
                sentences=list(report.help_sentences),
                resources=[
                    FunnelReportResourceDTO(code=r.code, text=r.text) for r in report.resources
                ],
            ),
            limits=list(report.limits),
            sources=list(report.sources),
            professional=None
            if pro is None
            else FunnelReportProfessionalDTO(
                main_action=pro.main_action,
                associated_actions=list(pro.associated_actions),
                templates=list(pro.templates),
                rules=list(pro.rules),
                flags=[FunnelReportFlagDTO(id=f.id, reasons=list(f.reasons)) for f in pro.flags],
                alerts=list(pro.alerts),
                pending_data=list(pro.pending_data),
                safety=[
                    FunnelReportSafetyDTO(
                        question=s.question,
                        answer=s.answer,
                        when=s.when,
                    )
                    for s in pro.safety
                ],
                answers=[
                    FunnelReportAnswerDTO(
                        id=a.id,
                        question=a.question,
                        answer=a.answer,
                        origin=a.origin,
                    )
                    for a in pro.answers
                ],
                narrative=pro.narrative,
                grounding=None
                if pro.grounding is None
                else FunnelReportGroundingDTO(
                    source_ids=list(pro.grounding.source_ids),
                    queries=list(pro.grounding.queries),
                ),
            ),
        )

    # --- the AI's proposals, as the person and the team see them ---

    def _item_question(self, item_id: str) -> str:
        if item_id.startswith("Q14."):
            # v0.2's whole Q14 (the screens break it down, p. 4).
            q14: str = next(
                q["text"] for q in self._a.raw["source"]["questions"] if q["id"] == "Q14"
            )
            return q14
        return self._a.step(item_id).text

    def _item_label(self, item_id: str, value: Any) -> str:
        if item_id.startswith("Q14."):
            name = item_id.removeprefix("Q14.")
            if value is True:
                # The approved Z1 phrase for the same fact ("tiene epilepsia").
                phrase = next(
                    (
                        p.text
                        for phrases in self._c.lists.values()
                        for p in phrases.phrases
                        if p.when == {"x": name}
                    ),
                    name,
                )
                return phrase[:1].upper() + phrase[1:]
            label = dict(extraction.Q14_TEXT_PARTS).get(name, name)
            return f"{label[:1].upper()}{label[1:]}: «{value}»"
        return answer_label(Answer(value=value), self._a.step(item_id), "ask")

    def _extraction(self, step: Step, answers: dict[str, Answer]) -> FunnelExtractionDTO:
        record = extraction.record_of(answers.get(self._record_key(step.key)))
        assert record is not None
        targets = {t.id: t for t in extraction.all_targets(self._a)}
        items: list[FunnelExtractionItemDTO] = []
        for item in record.items:
            editable = extraction.is_editable(targets[item.id])
            d = self._a.step(item.id) if editable else None
            items.append(
                FunnelExtractionItemDTO(
                    id=item.id,
                    question=self._item_question(item.id),
                    answer=self._item_label(item.id, item.value),
                    evidence=item.evidence,
                    editable=editable,
                    type=d.type if d is not None else "info",
                    options=[FunnelOptionDTO(key=o.key, label=o.label) for o in d.options]
                    if d is not None
                    else [],
                    fields=[FunnelOptionDTO(key=f.key, label=f.label) for f in d.fields]
                    if d is not None
                    else [],
                    none_option=d.none_option if d is not None else False,
                    unit=d.unit if d is not None else None,
                    units=self._units(d) if d is not None and d.type == "duration" else [],
                )
            )
        return FunnelExtractionDTO(source=record.source, items=items)

    def _ai_panel(self, answers: dict[str, Answer]) -> list[FunnelAiPanelDTO]:
        """For the team: what the AI proposed, the words it came from, and what the person did."""
        panels: list[FunnelAiPanelDTO] = []
        for key, answer in answers.items():
            record = extraction.record_of(answer) if extraction.is_record_key(key) else None
            if record is None:
                continue
            decision_key = key.removesuffix(extraction.RECORD) + extraction.DECISION
            chosen = extraction.decisions_of(answers.get(decision_key))
            items: list[FunnelAiItemPanelDTO] = []
            for item in record.items:
                entry = chosen.get(item.id, {})
                decision = entry.get("decision", "pendiente")
                corrected = entry.get("value") if decision == extraction.CORRECTED else None
                items.append(
                    FunnelAiItemPanelDTO(
                        id=item.id,
                        question=self._item_question(item.id),
                        answer=self._item_label(item.id, item.value),
                        evidence=item.evidence,
                        decision=decision,
                        corrected=None
                        if corrected is None
                        else self._item_label(item.id, corrected),
                    )
                )
            risk = record.risk
            panels.append(
                FunnelAiPanelDTO(
                    source=record.source,
                    status="ok" if record.status == "ok" else "failed",
                    model=record.model,
                    prompt_version=record.prompt_version,
                    risk=FunnelAiRiskDTO(s1=risk.get("S1"), s4=risk.get("S4"), s2=risk.get("S2")),
                    discarded=record.discarded,
                    items=items,
                )
            )
        return panels

    def _history(self, answers: dict[str, Answer], iv: Interview) -> list[FunnelHistoryItemDTO]:
        # What the person confirmed from their narrative is listed as theirs too,
        # so Z1 can correct it like any other answer.
        items: list[FunnelHistoryItemDTO] = []
        for key, answer in iv.answers.items():
            definition, kind = self._definition_for(key)
            if definition is None or kind in ("info", CONFIRM_KIND):
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
