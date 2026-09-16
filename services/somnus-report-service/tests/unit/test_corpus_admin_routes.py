"""What the corpus console API cannot express (Addendum B §B3 / §B3.1, 16.3).

These are structural properties of the router and the wire contract, so they are
asserted without a database: they must hold on every machine, and they are the
ones a future change is most likely to break quietly.

The behaviour that needs real rows — the draft → published → retired lifecycle,
and publish agreeing with §B4's gate case by case — is in
`tests/integration/test_corpus_console_api.py`.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from report.api.corpus_admin import router
from report.schemas.corpus import (
    CorpusDocumentCreateRequestDTO,
    CorpusDocumentEditRequestDTO,
    CorpusPublishRequestDTO,
    CorpusRetireRequestDTO,
    CorpusScopeDTO,
    CorpusSearchRequestDTO,
)

#: Every field §B3.1 says belongs to `morpheo_workflows_v1.json`. A request able
#: to carry one of these would make "read-only" a property of the screen.
ARTIFACT_OWNED_FIELDS = {
    "id": "SRC-05",
    "use": "un uso inventado",
    "citedByRules": ["SAFE-001"],
    "cited_by_rules": ["SAFE-001"],
    "url": "https://attacker.example/replaced",
}

REQUESTS = [
    (
        CorpusDocumentCreateRequestDTO,
        {
            "title": "t",
            "citation": "c",
            "sourceType": "guideline",
            "locale": "es",
            "scopes": [{"scopeType": "module", "scopeKey": "INS"}],
        },
    ),
    (CorpusDocumentEditRequestDTO, {"title": "t"}),
    (CorpusPublishRequestDTO, {"changelog": "Alta."}),
    (CorpusRetireRequestDTO, {"reason": "Obsoleta.", "changelog": "Retirada."}),
    (CorpusSearchRequestDTO, {}),
]


def _routes() -> list[tuple[str, frozenset[str]]]:
    return [(route.path, frozenset(route.methods)) for route in router.routes]  # type: ignore[attr-defined]


def test_the_router_has_no_delete_route() -> None:
    """§B3: append and retire. Retire keeps the row, which is the point of it."""
    paths = _routes()
    assert paths, "the corpus router registered nothing"

    for path, methods in paths:
        assert "DELETE" not in methods, f"{path} accepts DELETE"
        assert "delete" not in path.lower(), f"{path} looks like a delete route"


def test_retire_is_reachable() -> None:
    assert any(path.endswith("/retire") for path, _ in _routes())


def test_the_lifecycle_routes_are_all_there() -> None:
    suffixes = {path.rsplit("/", 1)[-1] for path, _ in _routes()}
    assert {"documents", "search", "edit", "publish", "retire", "sources"} <= suffixes


@pytest.mark.parametrize("model,valid", REQUESTS)
@pytest.mark.parametrize("field", sorted(ARTIFACT_OWNED_FIELDS))
def test_no_request_shape_can_carry_an_artifact_owned_field(
    model: type, valid: dict[str, object], field: str
) -> None:
    """§B3.1 at the contract, where the UI cannot soften it.

    `citation` is absent from this list deliberately: a console document has a
    citation of its own, and writing it changes that document and nothing about
    the SRC entry the deterministic engine cites.
    """
    model(**valid)  # the base body is fine
    with pytest.raises(ValidationError):
        model(**valid, **{field: ARTIFACT_OWNED_FIELDS[field]})


def test_a_scope_cannot_be_invented() -> None:
    CorpusScopeDTO(scope_type="clinical_source", scope_key="SRC-05")
    with pytest.raises(ValidationError):
        CorpusScopeDTO(scope_type="whatever", scope_key="x")
