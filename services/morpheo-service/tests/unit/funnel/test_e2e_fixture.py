"""The E2E fixture is the engine's own plan: regenerate it whenever this fails.

The app's Playwright test (apps/somnus-app/tests/e2e/funnel-v2.spec.ts) plays
FT-1 and V-10 through the real UI from this file and asserts the same final
text as the vignette runner. If the engine, the catalogue or a vignette
changes, run `uv run python -X utf8 -m morpheo.funnel.vignettes --e2e-fixture`
and then `biome format --write` on the file.
"""

from __future__ import annotations

import json

from morpheo.funnel.vignettes import (
    E2E_FIXTURE,
    E2E_VIGNETTES,
    e2e_fixture,
    load_vignettes,
    run_vignette,
)


def test_the_committed_fixture_matches_the_engine() -> None:
    # Compared as data: the committed file is laid out by Biome.
    committed = json.loads(E2E_FIXTURE.read_text(encoding="utf-8"))
    assert committed == json.loads(e2e_fixture())


def test_the_fixture_ends_with_the_runners_final_text() -> None:
    plans = json.loads(E2E_FIXTURE.read_text(encoding="utf-8"))["vignettes"]
    assert [p["id"] for p in plans] == list(E2E_VIGNETTES)
    for plan in plans:
        vignette = next(v for v in load_vignettes() if v["id"] == plan["id"])
        assert plan["finalText"] == [text for _, text in run_vignette(vignette).result.texts]


def test_the_driver_case_shows_the_warning_at_that_moment() -> None:
    plans = {p["id"]: p for p in json.loads(E2E_FIXTURE.read_text(encoding="utf-8"))["vignettes"]}
    keys = [s["key"] for s in plans["V-10"]["steps"]]
    at = keys.index("S2@exception:Q01")
    assert keys[at + 1 : at + 3] == ["S2_aviso", "S2_seguro"]
