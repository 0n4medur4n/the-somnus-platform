"""Nothing unrighted reaches the embedding provider (§B4 / Checkpoint 16.2).

§B4's most consequential line: "No document reaches the embedding API before
`rights_status` is set", because the failure is uploading a paywalled article's
full text to a third party — a legal problem, not a data-integrity one.

Every test here asserts at the **adapter boundary**: `_SpyEmbedder` is the
`EmbeddingProvider` the Checkpoint 11.3 adapter implements, and the assertion is
that it was never called. Not that an exception was raised somewhere — that a
request was never made.

Crucially, none of these tests publishes anything. The gate has to hold for a
caller that never went near the publish transition, which is exactly the caller
§B4 is worried about: a backfill, a console path, 16.4's retrieval wiring.
"""

from __future__ import annotations

import pytest

from report.corpus.chunking import CITATION_ONLY_MAX_CHARACTERS
from report.corpus.embedding_gate import CorpusEmbeddingGate, EmbeddableDocument
from report.corpus.rights import (
    RIGHTS_CITATION_ONLY,
    RIGHTS_LICENSED,
    RIGHTS_OPEN_ACCESS,
    RIGHTS_OWN_DOCUMENT,
    RightsError,
    build_evidence,
)
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse

MODEL = "text-embedding-3-large"
TEXTS = ["Un resumen corto.", "Otro párrafo aprobado."]


class _SpyEmbedder:
    """The Checkpoint 11.3 provider boundary. Records every call it receives."""

    def __init__(self) -> None:
        self.calls: list[EmbeddingRequest] = []

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls.append(request)
        return EmbeddingResponse(vectors=[[0.1, 0.2] for _ in request.inputs], model=request.model)


def _gate() -> tuple[CorpusEmbeddingGate, _SpyEmbedder]:
    spy = _SpyEmbedder()
    return CorpusEmbeddingGate(spy), spy


def _document(status: str | None, evidence: str | None = None) -> EmbeddableDocument:
    return EmbeddableDocument(id="doc-1", rights_status=status, rights_evidence=evidence)


# --- the boundary refusals ----------------------------------------------------


@pytest.mark.parametrize("unset", [None, "", "   "])
def test_an_unrighted_document_never_reaches_the_provider(unset: str | None) -> None:
    gate, spy = _gate()

    with pytest.raises(RightsError, match="rights_status is not set"):
        gate.embed(_document(unset), TEXTS, model=MODEL, dimensions=2)

    # The assertion that matters: no request was made, not merely that we raised.
    assert spy.calls == []


def test_this_holds_without_the_publish_gate_having_run_at_all() -> None:
    """The independence §B4 asks for, stated as a test.

    Nothing in this module publishes. The document here is a bare draft that no
    transition has ever inspected, which is precisely the caller the second check
    exists for.
    """
    gate, spy = _gate()
    never_published = _document(None)

    with pytest.raises(RightsError):
        gate.embed(never_published, TEXTS, model=MODEL, dimensions=2)
    assert spy.calls == []


def test_an_unknown_status_never_reaches_the_provider() -> None:
    gate, spy = _gate()
    with pytest.raises(RightsError, match="unknown rights_status"):
        gate.embed(_document("probably_fine"), TEXTS, model=MODEL, dimensions=2)
    assert spy.calls == []


@pytest.mark.parametrize(
    ("status", "evidence"),
    [
        (RIGHTS_OPEN_ACCESS, None),
        (RIGHTS_OPEN_ACCESS, build_evidence(licence="CC-BY-4.0")),
        (RIGHTS_LICENSED, build_evidence(licence="Elsevier")),
        (RIGHTS_OPEN_ACCESS, '{"licence": "CC-BY-4.0", "url": ""}'),
    ],
)
def test_a_status_without_its_evidence_never_reaches_the_provider(
    status: str, evidence: str | None
) -> None:
    # Missing evidence is refused at this boundary too, exactly as at publish: an
    # empty licence field is not a licence.
    gate, spy = _gate()
    with pytest.raises(RightsError):
        gate.embed(_document(status, evidence), TEXTS, model=MODEL, dimensions=2)
    assert spy.calls == []


def test_a_citation_only_document_over_its_cap_never_reaches_the_provider() -> None:
    """The cap, re-checked where the third-party call happens.

    Text could have been stored while the document claimed a status that permits
    full text and narrowed to `citation_only` afterwards. The chunker cannot know
    that; this call is the one that would send it.
    """
    gate, spy = _gate()
    oversized = ["a" * (CITATION_ONLY_MAX_CHARACTERS + 1)]

    with pytest.raises(RightsError, match="refused"):
        gate.embed(_document(RIGHTS_CITATION_ONLY), oversized, model=MODEL, dimensions=2)
    assert spy.calls == []


# --- and what it does let through ---------------------------------------------


@pytest.mark.parametrize(
    ("status", "evidence"),
    [
        (RIGHTS_OWN_DOCUMENT, None),
        (RIGHTS_CITATION_ONLY, None),
        (RIGHTS_OPEN_ACCESS, build_evidence(licence="CC-BY-4.0", url="https://example.org/g")),
        (RIGHTS_LICENSED, build_evidence(licence="Elsevier", holder="Hospital X")),
    ],
)
def test_a_properly_righted_document_is_embedded(status: str, evidence: str | None) -> None:
    gate, spy = _gate()
    response = gate.embed(_document(status, evidence), TEXTS, model=MODEL, dimensions=2)

    assert len(spy.calls) == 1
    assert spy.calls[0].inputs == TEXTS
    assert spy.calls[0].model == MODEL
    assert len(response.vectors) == len(TEXTS)


def test_nothing_to_embed_makes_no_call_at_all() -> None:
    gate, spy = _gate()
    response = gate.embed(_document(RIGHTS_OWN_DOCUMENT), [], model=MODEL, dimensions=2)
    assert spy.calls == []
    assert response.vectors == []
