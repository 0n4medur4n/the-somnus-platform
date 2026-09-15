"""The indexer persists embeddings into `somnus_reporting` (build plan §3.6b).

Uses a fake embedder (no live OpenAI) and the real repository + DB, so the vector
JSON round-trips through MySQL. Runs in CI where MySQL is provisioned.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import replace

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from report.application.retrieval import CitationResolver
from report.application.source_indexer import (
    ContentVersionDriftError,
    SourceIndexer,
    embedding_text,
)
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.infrastructure.models import ClinicalSourceRow
from report.jobs import index_sources
from report.jobs.index_sources import UnconfiguredEmbedder, run_index
from report.repositories.sources_repository import SourcesRepository
from report.schemas.retrieval import CorpusEntry
from report.schemas.sources import ClinicalSourceDTO, ClinicalSourcesDTO
from report.settings.config import Settings

_SOURCES = [
    ClinicalSourceDTO(id="SRC-01", citation="Riemann D.", url="https://x/1", use="Insomnio."),
    ClinicalSourceDTO(id="SRC-02", citation="Kapur VK.", url="https://x/2", use="AOS."),
]


class _FakeSources:
    def get_sources(self) -> ClinicalSourcesDTO:
        return ClinicalSourcesDTO(content_version="1.3", sources=_SOURCES)


class _FakeEmbedder:
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        vectors = [[0.1, 0.2, 0.3] for _ in request.inputs]
        return EmbeddingResponse(vectors=vectors, model="text-embedding-3-large")


def test_indexer_stores_embeddings_that_round_trip_through_mysql(engine: Engine) -> None:
    with Session(engine) as session:
        session.query(ClinicalSourceRow).delete()
        session.commit()

        repository = SourcesRepository(session)
        result = SourceIndexer(
            _FakeSources(),
            _FakeEmbedder(),
            repository,
            model="text-embedding-3-large",
            dimensions=3072,
        ).index()
        session.commit()

        assert result.indexed == 2
        rows = repository.list_version("1.3")
        assert [row.source_id for row in rows] == ["SRC-01", "SRC-02"]
        assert rows[0].embedding_model == "text-embedding-3-large"
        # The vector round-tripped through the LONGTEXT column as JSON.
        assert json.loads(rows[0].embedding or "[]") == [0.1, 0.2, 0.3]

        session.query(ClinicalSourceRow).delete()
        session.commit()


# --- Checkpoint 16.0: the lifecycle, through the job's own transaction --------
#
# These go through `run_index` -- the function `python -m report.jobs.index_sources`
# calls -- so the commit/rollback boundary under test is the real one, not a fake
# store's. Counts are taken at the embedding adapter, never from timing.


_MODEL = "text-embedding-3-large"
_SETTINGS = Settings(EMBEDDING_MODEL=_MODEL, EMBEDDING_DIMENSIONS=3)
_A = ClinicalSourceDTO("SRC-01", "Riemann D.", "https://x/1", "Insomnio.", ("SAFE-006",))
_B = ClinicalSourceDTO("SRC-02", "Kapur VK.", "https://x/2", "AOS.", ("SAFE-001",))
_C = ClinicalSourceDTO("SRC-03", "Morgenthaler TI.", "https://x/3", "Parametros.", ())


class _Versioned:
    def __init__(self, version: str, sources: Sequence[ClinicalSourceDTO]) -> None:
        self._corpus = ClinicalSourcesDTO(content_version=version, sources=list(sources))

    def get_sources(self) -> ClinicalSourcesDTO:
        return self._corpus


class _Counting:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls.append(list(request.inputs))
        return EmbeddingResponse(
            vectors=[[float(len(text)), 1.0, 2.0] for text in request.inputs], model=_MODEL
        )


class _Raising(_Counting):
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls.append(list(request.inputs))
        raise RuntimeError("provider unavailable")


@pytest.fixture
def clean(engine: Engine):  # type: ignore[no-untyped-def]
    with Session(engine) as session:
        session.query(ClinicalSourceRow).delete()
        session.commit()
    yield sessionmaker(bind=engine, expire_on_commit=False)
    with Session(engine) as session:
        session.query(ClinicalSourceRow).delete()
        session.commit()


def _run(factory, sources, version, embedder):  # type: ignore[no-untyped-def]
    return run_index(
        settings=_SETTINGS,
        provider=_Versioned(version, sources),
        embedder=embedder,
        session_factory=factory,
    )


def _rows(factory, version):  # type: ignore[no-untyped-def]
    with factory() as session:
        return {
            row.source_id: (row.citation, row.use_text, row.text_hash, row.embedding)
            for row in SourcesRepository(session).list_version(version)
        }


def test_an_unchanged_rerun_against_mysql_makes_zero_calls(clean) -> None:  # type: ignore[no-untyped-def]
    first = _Counting()
    _run(clean, [_A, _B, _C], "1.3", first)
    assert len(first.calls) == 1
    stored = _rows(clean, "1.3")

    again = _Counting()
    result = _run(clean, [_A, _B, _C], "1.3", again)

    assert again.calls == []
    assert (result.embedded, result.reused, result.unchanged) == (0, 0, 3)
    assert _rows(clean, "1.3") == stored


def test_an_unchanged_rerun_needs_no_api_key_at_all(clean) -> None:  # type: ignore[no-untyped-def]
    _run(clean, [_A, _B, _C], "1.3", _Counting())
    # UnconfiguredEmbedder raises the moment it is called; a clean run proves it wasn't.
    result = _run(clean, [_A, _B, _C], "1.3", UnconfiguredEmbedder())
    assert result.unchanged == 3


@pytest.mark.parametrize("field", ["citation", "use"])
def test_a_bump_re_embeds_only_the_changed_source_against_mysql(clean, field: str) -> None:  # type: ignore[no-untyped-def]
    _run(clean, [_A, _B, _C], "1.3", _Counting())

    changed = replace(_B, **{field: getattr(_B, field) + " revisado"})
    bump = _Counting()
    result = _run(clean, [_A, changed, _C], "1.4", bump)

    assert bump.calls == [[embedding_text(changed)]]
    assert (result.embedded, result.reused) == (1, 2)
    old, new = _rows(clean, "1.3"), _rows(clean, "1.4")
    assert new["SRC-01"][3] == old["SRC-01"][3]
    assert new["SRC-03"][3] == old["SRC-03"][3]


def test_a_failure_during_the_write_persists_nothing(clean) -> None:  # type: ignore[no-untyped-def]
    """Partial failure at the persistence boundary, not just before it.

    The third source's id is longer than `source_id` VARCHAR(16), so MySQL rejects
    that insert during the flush -- after the other two rows are already in the
    session. The job's single transaction has to take all three back out.
    """
    too_long = ClinicalSourceDTO("SRC-" + "9" * 20, "X.", "https://x/9", "Y.", ())
    with pytest.raises(Exception):  # noqa: B017 - the driver error type is the database's
        _run(clean, [_A, _B, too_long], "1.3", _Counting())
    assert _rows(clean, "1.3") == {}


def test_a_failed_bump_leaves_the_new_version_empty_and_the_old_one_whole(clean) -> None:  # type: ignore[no-untyped-def]
    _run(clean, [_A, _B, _C], "1.3", _Counting())
    before = _rows(clean, "1.3")

    raising = _Raising()
    with pytest.raises(RuntimeError, match="provider unavailable"):
        _run(clean, [_A, replace(_B, use="Otra."), _C], "1.4", raising)

    assert len(raising.calls) == 1
    assert _rows(clean, "1.4") == {}
    assert _rows(clean, "1.3") == before


def test_an_earlier_version_still_resolves_after_a_newer_one_is_indexed(clean) -> None:  # type: ignore[no-untyped-def]
    _run(clean, [_A, _B, _C], "1.3", _Counting())
    rewritten = replace(_A, citation="Riemann D. 2025 update.")
    _run(clean, [rewritten, _B, _C], "1.4", _Counting())

    def loader(version: str) -> list[CorpusEntry]:
        with clean() as session:
            return [
                CorpusEntry(
                    row.source_id,
                    row.citation,
                    row.url,
                    json.loads(row.embedding or "[]"),
                    tuple(json.loads(row.cited_by_rules or "[]")),
                )
                for row in SourcesRepository(session).list_version(version)
            ]

    resolver = CitationResolver(loader)
    assert [s.citation for s in resolver.resolve("1.3", ["SAFE-006"])] == ["Riemann D."]
    assert [s.citation for s in resolver.resolve("1.4", ["SAFE-006"])] == [
        "Riemann D. 2025 update."
    ]


def test_editing_an_indexed_version_without_a_bump_is_refused_against_mysql(clean) -> None:  # type: ignore[no-untyped-def]
    _run(clean, [_A, _B, _C], "1.3", _Counting())
    before = _rows(clean, "1.3")

    embedder = _Counting()
    with pytest.raises(ContentVersionDriftError):
        _run(clean, [_A, replace(_B, use="Editado."), _C], "1.3", embedder)

    assert embedder.calls == []
    assert _rows(clean, "1.3") == before


def test_the_operator_entry_point_prints_counts_and_is_safe_to_repeat(
    clean,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """`python -m report.jobs.index_sources`, as the runbook runs it -- twice."""
    embedder = _Counting()
    monkeypatch.setattr(
        index_sources, "MorpheoSourcesClient", lambda _url: _Versioned("1.3", [_A, _B, _C])
    )
    monkeypatch.setattr(index_sources, "build_embedder", lambda _settings: embedder)
    monkeypatch.setenv("EMBEDDING_MODEL", _MODEL)
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "3")

    assert index_sources.main() == 0
    first = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert (first["embedded"], first["indexed"]) == (3, 3)

    assert index_sources.main() == 0
    second = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    # The runbook's "confirm it" step, checked against the real database.
    assert (second["embedded"], second["reused"], second["unchanged"]) == (0, 0, 3)
    assert len(embedder.calls) == 1


def test_the_operator_entry_point_exits_non_zero_and_writes_nothing_on_refusal(
    clean,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(
        index_sources, "MorpheoSourcesClient", lambda _url: _Versioned("1.3", [_A, _B, _C])
    )
    monkeypatch.setattr(index_sources, "build_embedder", lambda _settings: UnconfiguredEmbedder())

    assert index_sources.main() == 1
    captured = capsys.readouterr()
    assert "refused" in captured.err and "OPENAI_API_KEY" in captured.err
    # No source text leaks into the error line.
    assert "Riemann" not in captured.err
    assert captured.out == ""
    assert _rows(clean, "1.3") == {}
