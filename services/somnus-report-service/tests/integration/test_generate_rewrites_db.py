"""The generation job against a real MySQL (build plan §19).

The model and Morpheo are faked; the queue is the real one. What matters: every
rewordable sentence gets exactly one pending candidate, a second run proposes
nothing new, and a candidate the scanner blocks is never queued.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator

import pytest
from sqlalchemy import delete, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.application.ai_wording import rewritable_texts
from report.infrastructure.llm.provider import LlmRequest, LlmResponse
from report.infrastructure.models import AiContentReviewItemRow
from report.jobs.generate_rewrites import run_generation
from report.schemas.render import ClinicalContentDTO
from report.settings.config import Settings


class _Content:
    def __init__(self, content: ClinicalContentDTO) -> None:
        self._content = content

    def get_content(self) -> ClinicalContentDTO:
        return self._content


class _Model:
    def __init__(self, reply: Callable[[str], str] | None = None) -> None:
        self.requests: list[LlmRequest] = []
        self._reply = reply

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        text = (
            self._reply(request.user) if self._reply else f"En palabras sencillas: {request.user}"
        )
        return LlmResponse(text=text, model=request.model)


@pytest.fixture
def factory(engine: Engine) -> Iterator[sessionmaker[Session]]:
    make = sessionmaker(bind=engine, expire_on_commit=False)
    with make() as session:
        session.execute(delete(AiContentReviewItemRow))
        session.commit()
    yield make
    with make() as session:
        session.execute(delete(AiContentReviewItemRow))
        session.commit()


def test_every_sentence_gets_one_pending_candidate_and_a_rerun_adds_none(
    factory: sessionmaker[Session], content: ClinicalContentDTO
) -> None:
    model = _Model()
    first = run_generation(
        settings=Settings(), content=_Content(content), provider=model, session_factory=factory
    )
    expected = len(rewritable_texts(content))
    assert (first.queued, first.already_covered, first.blocked) == (expected, 0, 0)
    # Maximum reasoning effort, and only Morpheo's approved sentences go out.
    assert {request.reasoning_effort for request in model.requests} == {"max"}
    assert {request.user for request in model.requests} == {
        entry.text for entry in rewritable_texts(content)
    }
    with factory() as session:
        rows = session.scalars(select(AiContentReviewItemRow)).all()
    assert {row.status for row in rows} == {"pending_review"}
    assert all(row.report_id is None and row.text_ref for row in rows)

    second = run_generation(
        settings=Settings(), content=_Content(content), provider=_Model(), session_factory=factory
    )
    assert (second.queued, second.already_covered) == (0, expected)


def test_a_blocked_candidate_is_never_queued(
    factory: sessionmaker[Session], content: ClinicalContentDTO
) -> None:
    blocked_content = content.model_copy(update={"blocked_claims": ["Morpheo diagnostica"]})
    result = run_generation(
        settings=Settings(),
        content=_Content(blocked_content),
        provider=_Model(lambda _text: "Morpheo diagnostica tu problema."),
        session_factory=factory,
    )
    assert result.queued == 0
    assert result.blocked == len(rewritable_texts(content))
    with factory() as session:
        assert session.scalars(select(AiContentReviewItemRow)).all() == []
