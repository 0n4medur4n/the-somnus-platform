"""The clinical-source indexer (build plan §3.6b / Checkpoint 11.3 Stage 3 / 16.0).

Two guarantees from Stage 3 still hold and are asserted first: ONLY the approved
corpus text (citation + use) is ever embedded, and a count mismatch persists
nothing.

Checkpoint 16.0 (Addendum B §B2a.1) adds the lifecycle. Every "how many calls"
assertion below counts calls at the embedding adapter — the `_CountingEmbedder`
is the provider boundary itself — never elapsed time, which would pass for a fast
network as readily as for no network at all.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

import pytest

from report.application.retrieval import CitationResolver
from report.application.source_indexer import (
    ContentVersionDriftError,
    IndexResult,
    SourceIndexer,
    embedding_text,
    text_hash,
)
from report.infrastructure.llm.provider import EmbeddingRequest, EmbeddingResponse
from report.schemas.retrieval import CorpusEntry
from report.schemas.sources import (
    ClinicalSourceDTO,
    ClinicalSourcesDTO,
    IndexedEntry,
    IndexedRow,
)

MODEL = "text-embedding-3-large"
DIMENSIONS = 4

SRC_01 = ClinicalSourceDTO(
    id="SRC-01",
    citation="Riemann D, et al. Insomnia 2023.",
    url="https://x/1",
    use="Insomnio.",
    cited_by_rules=("SAFE-006",),
)
SRC_02 = ClinicalSourceDTO(
    id="SRC-02",
    citation="Kapur VK, et al. OSA.",
    url="https://x/2",
    use="Sospecha de AOS.",
    cited_by_rules=("SAFE-001",),
)
SRC_03 = ClinicalSourceDTO(
    id="SRC-03",
    citation="Morgenthaler TI.",
    url="https://x/3",
    use="Parámetros.",
    cited_by_rules=(),
)
CORPUS_1_3 = [SRC_01, SRC_02, SRC_03]


# --- fakes --------------------------------------------------------------------


class _Sources:
    def __init__(self, version: str, sources: Sequence[ClinicalSourceDTO]) -> None:
        self.version = version
        self.sources = list(sources)

    def get_sources(self) -> ClinicalSourcesDTO:
        return ClinicalSourcesDTO(content_version=self.version, sources=list(self.sources))


class _CountingEmbedder:
    """The embedding adapter boundary. Every call and every input is recorded."""

    def __init__(self, *, model: str = MODEL, dimensions: int = DIMENSIONS) -> None:
        self.calls: list[EmbeddingRequest] = []
        self._model = model
        self._dimensions = dimensions

    @property
    def inputs(self) -> list[str]:
        return [text for call in self.calls for text in call.inputs]

    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls.append(request)
        # A vector derived from the text, so a reused vector and a freshly
        # embedded one for the same text are recognisably the same.
        vectors = [
            [float((hash(text) >> shift) % 97) for shift in range(self._dimensions)]
            for text in request.inputs
        ]
        return EmbeddingResponse(vectors=vectors, model=self._model)


class _ShortEmbedder(_CountingEmbedder):
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls.append(request)
        # One fewer vector than inputs: the Stage 3 fault case.
        return EmbeddingResponse(vectors=[[0.0] * DIMENSIONS], model=MODEL)


class _FailingEmbedder(_CountingEmbedder):
    def embed(self, request: EmbeddingRequest) -> EmbeddingResponse:
        self.calls.append(request)
        raise RuntimeError("provider unavailable")


class _Row:
    def __init__(self, entry: IndexedEntry, model: str) -> None:
        self.source = entry.source
        self.text_hash: str | None = entry.text_hash
        self.vector: list[float] | None = list(entry.vector)
        self.model: str | None = model


class _InMemoryStore:
    """The `SourceIndexStore` port, in memory, with the same no-overwrite rule."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], _Row] = {}
        self.write_calls = 0

    def indexed_rows(self, content_version: str) -> list[IndexedRow]:
        return [
            IndexedRow(
                source_id=source_id,
                text_hash=row.text_hash,
                embedding_model=row.model,
                has_vector=row.vector is not None,
            )
            for (version, source_id), row in self.rows.items()
            if version == content_version
        ]

    def reusable_vectors(
        self, keys: Sequence[tuple[str, str]], model: str
    ) -> dict[tuple[str, str], list[float]]:
        wanted = set(keys)
        found: dict[tuple[str, str], list[float]] = {}
        for (_version, source_id), row in self.rows.items():
            key = (source_id, row.text_hash or "")
            if key in wanted and row.model == model and row.vector and key not in found:
                found[key] = list(row.vector)
        return found

    def write_indexed(
        self, content_version: str, entries: Sequence[IndexedEntry], model: str
    ) -> None:
        self.write_calls += 1
        for entry in entries:
            existing = self.rows.get((content_version, entry.source.id))
            if existing is not None and existing.vector is not None:
                raise AssertionError("the indexer tried to overwrite a stored vector")
            self.rows[(content_version, entry.source.id)] = _Row(entry, model)

    def snapshot(self) -> dict[tuple[str, str], tuple[str, str | None, tuple[float, ...]]]:
        return {
            key: (row.source.citation, row.text_hash, tuple(row.vector or ()))
            for key, row in self.rows.items()
        }

    def corpus_loader(self, content_version: str) -> list[CorpusEntry]:
        return [
            CorpusEntry(
                source_id=row.source.id,
                citation=row.source.citation,
                url=row.source.url,
                vector=list(row.vector or []),
                cited_by_rules=row.source.cited_by_rules,
            )
            for (version, _), row in sorted(self.rows.items())
            if version == content_version
        ]


def _index(
    store: _InMemoryStore,
    embedder: _CountingEmbedder,
    version: str = "1.3",
    sources: Sequence[ClinicalSourceDTO] = CORPUS_1_3,
    *,
    model: str = MODEL,
    dimensions: int = DIMENSIONS,
) -> IndexResult:
    return SourceIndexer(
        _Sources(version, sources), embedder, store, model=model, dimensions=dimensions
    ).index()


# --- Stage 3 guarantees, unchanged ------------------------------------------


def test_only_the_approved_corpus_text_is_embedded_never_pii_or_health() -> None:
    embedder = _CountingEmbedder()
    _index(_InMemoryStore(), embedder)

    # The embedder receives EXACTLY citation+use for each source and nothing else —
    # no patient data, no assessment answers, no query free-text.
    assert embedder.inputs == [embedding_text(source) for source in CORPUS_1_3]
    assert embedder.calls[0].model == MODEL
    assert embedder.calls[0].dimensions == DIMENSIONS


def test_a_first_run_embeds_every_source_in_one_call() -> None:
    store = _InMemoryStore()
    embedder = _CountingEmbedder()
    result = _index(store, embedder)

    assert len(embedder.calls) == 1
    assert (result.indexed, result.embedded, result.reused, result.unchanged) == (3, 3, 0, 0)
    assert sorted(source_id for _, source_id in store.rows) == ["SRC-01", "SRC-02", "SRC-03"]
    assert all(row.text_hash == text_hash(row.source) for row in store.rows.values())


def test_index_refuses_when_the_embedding_count_does_not_match() -> None:
    store = _InMemoryStore()
    with pytest.raises(ValueError, match="does not match"):
        _index(store, _ShortEmbedder())
    assert store.rows == {}
    assert store.write_calls == 0


# --- 16.0: an unchanged re-run is free ---------------------------------------


def test_an_unchanged_rerun_makes_zero_embedding_calls_and_writes_nothing() -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())
    before = store.snapshot()
    writes_before = store.write_calls

    rerun = _CountingEmbedder()
    result = _index(store, rerun)

    # Zero, counted at the adapter boundary.
    assert rerun.calls == []
    assert store.write_calls == writes_before
    assert store.snapshot() == before
    assert (result.embedded, result.reused, result.unchanged) == (0, 0, 3)


def test_running_it_many_times_still_costs_exactly_one_embedding_call() -> None:
    store = _InMemoryStore()
    embedder = _CountingEmbedder()
    for _ in range(5):
        _index(store, embedder)
    assert len(embedder.calls) == 1


# --- 16.0: a bump re-embeds only what changed ---------------------------------


@pytest.mark.parametrize("field", ["citation", "use"])
def test_changing_one_sources_text_re_embeds_that_source_only(field: str) -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())

    changed = replace(SRC_02, **{field: getattr(SRC_02, field) + " (revisado)"})
    bump = _CountingEmbedder()
    result = _index(store, bump, "1.4", [SRC_01, changed, SRC_03])

    # One call, carrying exactly one text: the changed source's.
    assert len(bump.calls) == 1
    assert bump.inputs == [embedding_text(changed)]
    assert (result.indexed, result.embedded, result.reused, result.unchanged) == (3, 1, 2, 0)
    # The untouched sources carry the very vectors 1.3 stored, not new ones.
    for source_id in ("SRC-01", "SRC-03"):
        assert store.rows[("1.4", source_id)].vector == store.rows[("1.3", source_id)].vector


def test_a_bump_that_only_changes_which_rules_cite_a_source_embeds_nothing() -> None:
    # `cited_by_rules` is not embedded text. Re-wiring a rule to a different source
    # is a new content_version, but it must not cost a single embedding.
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())

    rewired = replace(SRC_03, cited_by_rules=("SAFE-009",))
    bump = _CountingEmbedder()
    result = _index(store, bump, "1.4", [SRC_01, SRC_02, rewired])

    assert bump.calls == []
    assert (result.embedded, result.reused) == (0, 3)
    assert store.rows[("1.4", "SRC-03")].source.cited_by_rules == ("SAFE-009",)


def test_a_vector_is_only_reused_for_the_same_model_and_dimensions() -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())

    # Same text, different dimensions setting: a different embedding.
    bump = _CountingEmbedder(dimensions=8)
    result = _index(store, bump, "1.4", CORPUS_1_3, dimensions=8)
    assert (len(bump.calls), result.embedded, result.reused) == (1, 3, 0)

    # Same text, different model: also a different embedding.
    other = _CountingEmbedder(model="text-embedding-3-small")
    result = _index(store, other, "1.5", CORPUS_1_3, model="text-embedding-3-small")
    assert (len(other.calls), result.embedded, result.reused) == (1, 3, 0)


# --- 16.0: all or nothing -----------------------------------------------------


def test_a_provider_that_raises_persists_nothing() -> None:
    store = _InMemoryStore()
    with pytest.raises(RuntimeError, match="provider unavailable"):
        _index(store, _FailingEmbedder())
    assert store.rows == {}
    assert store.write_calls == 0


def test_a_failed_bump_does_not_persist_even_the_sources_it_could_have_reused() -> None:
    """The case that makes all-or-nothing more than a count check.

    On a bump, two of three sources are reusable and never reach the provider.
    If the one that does fails, the reusable two must not be written on their
    own — that would be a partial 1.4 index, exactly what §B2a.1 forbids.
    """
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())
    before = store.snapshot()

    changed = replace(SRC_02, use="Otra cosa.")
    failing = _FailingEmbedder()
    with pytest.raises(RuntimeError, match="provider unavailable"):
        _index(store, failing, "1.4", [SRC_01, changed, SRC_03])

    # The provider was asked for the one changed source only -- the other two were
    # reusable -- and its failure still kept all three out of 1.4.
    assert failing.inputs == [embedding_text(changed)]

    assert store.snapshot() == before
    assert not any(version == "1.4" for version, _ in store.rows)


def test_a_provider_answering_with_another_model_persists_nothing() -> None:
    store = _InMemoryStore()
    with pytest.raises(ValueError, match="answered with"):
        _index(store, _CountingEmbedder(model="some-other-model"))
    assert store.rows == {}


# --- 16.0: older versions stay resolvable ------------------------------------


def test_an_earlier_version_still_resolves_what_grounded_it_after_a_bump() -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())
    old_row = store.rows[("1.3", "SRC-01")]
    old_vector, old_citation = list(old_row.vector or []), old_row.source.citation

    rewritten = replace(SRC_01, citation="Riemann D, et al. Insomnia 2025 update.")
    _index(store, _CountingEmbedder(), "1.4", [rewritten, SRC_02, SRC_03])

    # 1.3 is exactly as it was: same citation text, same vector.
    assert store.rows[("1.3", "SRC-01")].source.citation == old_citation
    assert store.rows[("1.3", "SRC-01")].vector == old_vector
    # And a report grounded under 1.3 resolves 1.3's citation, not 1.4's.
    resolver = CitationResolver(store.corpus_loader)
    assert [s.citation for s in resolver.resolve("1.3", ["SAFE-006"])] == [old_citation]
    assert [s.citation for s in resolver.resolve("1.4", ["SAFE-006"])] == [rewritten.citation]


# --- 16.0: an indexed version is never rewritten ------------------------------


def test_text_changed_without_a_version_bump_is_refused_before_any_call() -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())
    before = store.snapshot()

    edited = replace(SRC_02, use="Editado sin subir versión.")
    embedder = _CountingEmbedder()
    with pytest.raises(ContentVersionDriftError, match="Bump content_version"):
        _index(store, embedder, "1.3", [SRC_01, edited, SRC_03])

    assert embedder.calls == []
    assert store.snapshot() == before


def test_a_source_dropped_from_an_indexed_version_is_refused() -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())
    with pytest.raises(ContentVersionDriftError, match="no longer contains"):
        _index(store, _CountingEmbedder(), "1.3", [SRC_01, SRC_02])


def test_a_model_change_under_the_same_version_is_refused() -> None:
    store = _InMemoryStore()
    _index(store, _CountingEmbedder())
    embedder = _CountingEmbedder(model="text-embedding-3-small")
    with pytest.raises(ContentVersionDriftError, match="new index"):
        _index(store, embedder, "1.3", CORPUS_1_3, model="text-embedding-3-small")
    assert embedder.calls == []


def test_a_legacy_vector_with_no_recorded_hash_is_never_trusted_or_rewritten() -> None:
    store = _InMemoryStore()
    legacy = _Row(IndexedEntry(source=SRC_01, text_hash="", vector=[1.0] * DIMENSIONS), MODEL)
    legacy.text_hash = None
    store.rows[("1.3", "SRC-01")] = legacy

    embedder = _CountingEmbedder()
    with pytest.raises(ContentVersionDriftError, match="no recorded text hash"):
        _index(store, embedder)
    assert embedder.calls == []
    assert store.rows[("1.3", "SRC-01")] is legacy
