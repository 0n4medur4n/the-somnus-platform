"""The clinical-source corpus persists and reads back (build plan §8 / §3.6b)."""

from __future__ import annotations

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from report.repositories.sources_repository import SourcesRepository
from report.schemas.sources import ClinicalSourceDTO

_SOURCES = [
    ClinicalSourceDTO(id="SRC-02", citation="Kapur VK, et al. OSA.", url="https://x/2", use="AOS."),
    ClinicalSourceDTO(
        id="SRC-01", citation="Riemann D, et al. Insomnia.", url="https://x/1", use="Insomnio."
    ),
]


def _clear(session: Session) -> None:
    from report.infrastructure.models import ClinicalSourceRow

    session.query(ClinicalSourceRow).delete()
    session.commit()


def test_replace_version_then_list_orders_by_source_id(engine: Engine) -> None:
    with Session(engine) as session:
        _clear(session)
        repo = SourcesRepository(session)
        repo.replace_version("1.3", _SOURCES)
        session.commit()

        rows = repo.list_version("1.3")
        assert [row.source_id for row in rows] == ["SRC-01", "SRC-02"]
        assert rows[0].citation.startswith("Riemann")
        # Embeddings are populated by the indexer (Stage 3); unset here.
        assert rows[0].embedding is None
        _clear(session)


def test_replace_version_is_idempotent(engine: Engine) -> None:
    with Session(engine) as session:
        _clear(session)
        repo = SourcesRepository(session)
        repo.replace_version("1.3", _SOURCES)
        repo.replace_version("1.3", _SOURCES)
        session.commit()

        assert len(repo.list_version("1.3")) == 2
        _clear(session)
