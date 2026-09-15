"""The clinical-source store, against MySQL (build plan §8 / §3.6b / Checkpoint 16.0).

Until Checkpoint 16.0 this store had `replace_version` and `replace_embedded`,
both of which deleted every row of a version and re-inserted it. The two tests
that used to live here exercised exactly that. They are replaced, not deleted:
the ordering guarantee is asserted the same way, and "idempotent replace" becomes
the property the store actually has now -- a stored vector is never replaced at
all, and the store itself refuses, independently of the indexer being correct.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from report.application.source_indexer import text_hash
from report.infrastructure.models import ClinicalSourceRow
from report.repositories.sources_repository import SourcesRepository, StoredVectorOverwriteError
from report.schemas.sources import ClinicalSourceDTO, IndexedEntry

MODEL = "text-embedding-3-large"
_SRC_02 = ClinicalSourceDTO(
    id="SRC-02", citation="Kapur VK, et al. OSA.", url="https://x/2", use="AOS."
)
_SRC_01 = ClinicalSourceDTO(
    id="SRC-01", citation="Riemann D, et al. Insomnia.", url="https://x/1", use="Insomnio."
)


def _entry(source: ClinicalSourceDTO, vector: list[float]) -> IndexedEntry:
    return IndexedEntry(source=source, text_hash=text_hash(source), vector=vector)


def _clear(session: Session) -> None:
    session.query(ClinicalSourceRow).delete()
    session.commit()


def test_written_rows_list_back_ordered_by_source_id(engine: Engine) -> None:
    with Session(engine) as session:
        _clear(session)
        repo = SourcesRepository(session)
        repo.write_indexed("1.3", [_entry(_SRC_02, [0.0, 1.0]), _entry(_SRC_01, [1.0, 0.0])], MODEL)
        session.commit()

        rows = repo.list_version("1.3")
        assert [row.source_id for row in rows] == ["SRC-01", "SRC-02"]
        assert rows[0].citation.startswith("Riemann")
        assert rows[0].text_hash == text_hash(_SRC_01)
        assert json.loads(rows[0].embedding or "[]") == [1.0, 0.0]
        _clear(session)


def test_a_stored_vector_is_never_overwritten(engine: Engine) -> None:
    with Session(engine) as session:
        _clear(session)
        repo = SourcesRepository(session)
        repo.write_indexed("1.3", [_entry(_SRC_01, [1.0, 0.0])], MODEL)
        session.commit()

        with pytest.raises(StoredVectorOverwriteError):
            repo.write_indexed("1.3", [_entry(_SRC_01, [9.0, 9.0])], MODEL)
        session.rollback()

        assert json.loads(repo.list_version("1.3")[0].embedding or "[]") == [1.0, 0.0]
        _clear(session)


def test_a_row_without_a_vector_can_have_one_filled_in(engine: Engine) -> None:
    # The one write to an existing row the store permits: supplying the vector a
    # row never had. Nothing that was stored is replaced.
    with Session(engine) as session:
        _clear(session)
        session.add(
            ClinicalSourceRow(
                content_version="1.3",
                source_id="SRC-01",
                citation=_SRC_01.citation,
                url=_SRC_01.url,
                use_text=_SRC_01.use,
            )
        )
        session.commit()

        repo = SourcesRepository(session)
        repo.write_indexed("1.3", [_entry(_SRC_01, [1.0, 0.0])], MODEL)
        session.commit()
        assert json.loads(repo.list_version("1.3")[0].embedding or "[]") == [1.0, 0.0]
        _clear(session)


def test_reusable_vectors_match_source_text_and_model_never_an_unhashed_row(
    engine: Engine,
) -> None:
    with Session(engine) as session:
        _clear(session)
        repo = SourcesRepository(session)
        repo.write_indexed("1.3", [_entry(_SRC_01, [1.0, 0.0])], MODEL)
        # A legacy row: a vector with no recorded hash.
        session.add(
            ClinicalSourceRow(
                content_version="1.2",
                source_id="SRC-02",
                citation=_SRC_02.citation,
                url=_SRC_02.url,
                use_text=_SRC_02.use,
                embedding=json.dumps([0.0, 1.0]),
                embedding_model=MODEL,
            )
        )
        session.commit()

        keys = [("SRC-01", text_hash(_SRC_01)), ("SRC-02", text_hash(_SRC_02))]
        assert repo.reusable_vectors(keys, MODEL) == {("SRC-01", text_hash(_SRC_01)): [1.0, 0.0]}
        assert repo.reusable_vectors(keys, "text-embedding-3-small") == {}
        _clear(session)
