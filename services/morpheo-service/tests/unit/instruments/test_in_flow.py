"""The instruments inside the interview: where, optional, scored, never deciding."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.instruments import DEFAULT_MARK, PENDING_FILE
from morpheo.funnel.interview import Answer, next_step
from morpheo.funnel.rules import evaluate
from morpheo.instruments.definitions import InstrumentRegistry, load_registry
from morpheo.settings.config import Settings

from .synthetic import write

A = funnel_artifact()
YES, NO = Answer(value="si"), Answer(value="no")
INSOMNIA = {
    "AGE": Answer(value=45),
    "Q08": Answer(value=["despertares"]),
    "Q05": Answer(value=4),
    "Q03": Answer(value={"value": 6, "unit": "meses"}),
    "Q15": Answer(value=[]),
    "Q11": Answer(value="cansancio"),
    "Q13": YES,
    "I1": YES,
    "I2": YES,
}


@pytest.fixture
def registry(tmp_path: Path) -> InstrumentRegistry:
    for code in ("ISI", "ESS", "STOP-BANG"):
        write(tmp_path, code)
    settings = Settings(_env_file=None, instruments_source_dir=str(tmp_path))
    return load_registry(settings, today=dt.date(2026, 10, 19), allow_synthetic=True)


def _walk(
    script: dict[str, Answer], registry: InstrumentRegistry | None
) -> tuple[list[str], dict[str, Answer]]:
    answers: dict[str, Answer] = {}
    keys: list[str] = []
    for _ in range(300):
        step = next_step(A, answers, registry)
        if step is None:
            return keys, answers
        keys.append(step.key)
        given = script.get(step.key)
        if given is None and step.key.endswith("#intro"):
            given = YES
        if given is None and "#" in step.key:
            given = Answer(value="1")
        if given is None:
            given = {"info": Answer(value="visto"), "confirm": Answer(value="sigue_igual")}.get(
                step.kind, NO
            )
        answers[step.key] = given
    raise AssertionError("the interview did not end")


def test_isi_comes_at_the_end_of_branch_i_when_i1_to_i3_are_yes(
    registry: InstrumentRegistry,
) -> None:
    keys, _ = _walk(INSOMNIA, registry)
    start = keys.index("ISI#intro")
    assert keys.index("I2") < start < keys.index("PROT")
    assert keys[start + 1 : start + 8] == [f"ISI#i{n}" for n in range(1, 8)]
    assert "ESS#intro" not in keys and "STOP-BANG#intro" not in keys


def test_the_isi_screen_shows_the_official_instructions_and_says_why(
    registry: InstrumentRegistry,
) -> None:
    answers = dict(INSOMNIA)
    for _ in range(100):
        step = next_step(A, answers, registry)
        assert step is not None
        if step.key == "ISI#intro":
            break
        answers[step.key] = INSOMNIA.get(step.key) or (
            Answer(value="visto") if step.kind == "info" else NO
        )
    assert step.kind == "instrument_intro"
    assert step.definition.text == registry.definitions["ISI"].instructions
    assert step.reason is not None and "p. 5, I6" in step.reason


def test_epworth_follows_branch_d_and_stop_bang_branch_r(registry: InstrumentRegistry) -> None:
    script = {
        "AGE": Answer(value=50),
        "Q08": Answer(value=[]),
        "Q11": Answer(value="dormido_sin_querer"),
        "Q15": Answer(value=["ronca_fuerte"]),
        "Q13": YES,
    }
    keys, _ = _walk(script, registry)
    assert keys.index("STOP-BANG#intro") < keys.index("ESS#intro") < keys.index("PROT")
    # Each comes after the last step of its own branch.
    assert keys.index("R6") < keys.index("STOP-BANG#intro") < keys.index("D2a")
    assert keys.index("D2b") < keys.index("ESS#intro")
    assert "ISI#intro" not in keys


def test_skipping_an_instrument_is_always_possible(registry: InstrumentRegistry) -> None:
    keys, answers = _walk(INSOMNIA | {"ISI#intro": NO}, registry)
    assert "ISI#i1" not in keys
    isi = next(o for o in evaluate(A, answers, registry).instruments if o.code == "ISI")
    assert isi.status == "declined" and isi.total is None


def test_a_completed_instrument_is_scored_with_its_official_cut_offs(
    registry: InstrumentRegistry,
) -> None:
    _, answers = _walk(INSOMNIA, registry)
    result = evaluate(A, answers, registry)
    isi = next(o for o in result.instruments if o.code == "ISI")
    assert (isi.status, isi.total) == ("completed", 7)
    assert isi.band == registry.definitions["ISI"].bands[0].label
    assert isi.official_sha256 == registry.definitions["ISI"].official_sha256
    assert result.instruments_note == "Ninguna escala confirma apnea ni sustituye la entrevista."


def test_an_item_left_unanswered_leaves_no_score(registry: InstrumentRegistry) -> None:
    _, answers = _walk(INSOMNIA | {"ISI#i4": Answer(absence="prefiero_no_responder")}, registry)
    isi = next(o for o in evaluate(A, answers, registry).instruments if o.code == "ISI")
    assert (isi.status, isi.total, isi.band) == ("incomplete", None, None)


def test_scores_never_change_the_orientation(registry: InstrumentRegistry) -> None:
    _, with_isi = _walk(INSOMNIA, registry)
    _, without = _walk(INSOMNIA, None)
    a, b = evaluate(A, with_isi, registry), evaluate(A, without)
    assert (a.accion_principal, a.texts, a.rule_ids) == (b.accion_principal, b.texts, b.rule_ids)


def test_without_its_official_file_an_instrument_is_skipped_and_reported_pending(
    tmp_path: Path,
) -> None:
    pending = load_registry(Settings(_env_file=None, instruments_source_dir=str(tmp_path)))
    keys, answers = _walk(INSOMNIA, pending)
    assert not any("#" in key for key in keys)
    result = evaluate(A, answers, pending)
    assert [(o.code, o.status) for o in result.instruments] == [("ISI", "pending_file")]
    assert result.instruments_note is None
    assert PENDING_FILE == "pendiente: archivo oficial de Jesús"


def test_epworth_and_stop_bang_placement_is_marked_as_a_default() -> None:
    from morpheo.funnel.instruments import PLACEMENT

    assert not PLACEMENT["ISI"].default
    assert PLACEMENT["ESS"].default and PLACEMENT["STOP-BANG"].default
    assert DEFAULT_MARK == "DEFAULT \N{EN DASH} Jesús puede cambiarlo"


def test_a_stopped_interview_offers_no_instrument(registry: InstrumentRegistry) -> None:
    narrative = Answer(value="x", text="A veces pienso en quitarme la vida")
    keys, answers = _walk(
        {"AGE": Answer(value=45), "Q01": narrative, "S4@exception:Q01": YES}, registry
    )
    assert keys == ["AGE", "Q01", "S4@exception:Q01"]
    assert evaluate(A, answers, registry).instruments == ()
