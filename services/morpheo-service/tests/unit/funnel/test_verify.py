"""The final text adds no fact or advice beyond the engine (v0.2 p. 14).

Negative tests: once green, they are not changed (CLAUDE.md).
"""

from __future__ import annotations

import pytest

from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.catalogue import funnel_catalogue
from morpheo.funnel.verify import verify
from morpheo.funnel.vignettes import load_vignettes, run_vignette
from morpheo.instruments.definitions import load_registry
from morpheo.settings.config import Settings

A = funnel_artifact()
C = funnel_catalogue()
REGISTRY = load_registry(Settings(_env_file=None))
RUNS = {v["id"]: run_vignette(v, A, REGISTRY) for v in load_vignettes()}


def _check(vignette_id: str, texts: list[tuple[str, str]]) -> list[str]:
    result = RUNS[vignette_id].result
    return verify(A, C, texts, (o.template for o in result.orientations))


@pytest.mark.parametrize("vignette_id", sorted(RUNS))
def test_every_vignettes_text_comes_from_templates_and_the_catalogue(vignette_id: str) -> None:
    assert _check(vignette_id, list(RUNS[vignette_id].result.texts)) == []


def test_an_added_sentence_is_caught() -> None:
    (template, text), *rest = RUNS["FT-1"].result.texts
    added = [(template, text + " Le recomendamos tomar melatonina."), *rest]
    [problem] = _check("FT-1", added)
    assert "melatonina" in problem


def test_a_reworded_fact_is_caught() -> None:
    texts = list(RUNS["FT-1"].result.texts)
    template, text = texts[0]
    assert "6 meses" in text or "meses" in text
    texts[0] = (template, text.replace("insomnio", "apnea grave"))
    assert _check("FT-1", texts)


def test_a_paragraph_no_orientation_asked_for_is_caught() -> None:
    texts = [*RUNS["FT-1"].result.texts, ("T_PSG", "Conviene valorar una polisomnografía.")]
    problems = _check("FT-1", texts)
    assert any("T_PSG" in p and "no orientation" in p for p in problems)


def test_a_text_written_by_anything_else_is_caught_even_from_approved_words() -> None:
    texts = [("T_INSOMNIO", "Usted tiene apnea; no necesita consulta.")]
    assert _check("FT-1", texts)
