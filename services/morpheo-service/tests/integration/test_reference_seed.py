"""The reference tables are seeded from the artifacts and stay consistent with
them and with the engine (build plan §20 Checkpoint 10.2)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from morpheo.clinical.loader import load_clinical
from morpheo.repositories.reference import ReferenceRepository

BUNDLE = load_clinical()


def test_seeded_version_matches_the_artifact(db_session: Session) -> None:
    repo = ReferenceRepository(db_session)
    assert repo.workflow_version() == BUNDLE.workflows.meta.version


def test_reference_counts_match_the_artifact(db_session: Session) -> None:
    repo = ReferenceRepository(db_session)
    wf = BUNDLE.workflows
    assert len(repo.roles()) == len(wf.roles)
    assert len(repo.safety_rules()) == len(wf.safety_rules)
    assert len(repo.modules()) == len(wf.modules)
    assert len(repo.clinical_sources()) == len(wf.sources)
    assert len(repo.core_questions()) == len(wf.core_questions)
    assert len(repo.claims()) == len(wf.claims_registry)
    assert len(repo.forbidden_phrases()) == len(wf.output_contract.forbidden_phrases)


def test_safety_rules_seeded_faithfully(db_session: Session) -> None:
    repo = ReferenceRepository(db_session)
    seeded = {rule.id: rule for rule in repo.safety_rules()}
    for rule in BUNDLE.workflows.safety_rules:
        row = seeded[rule.id]
        assert row.when_condition == rule.when
        assert row.level_id == rule.level.value
        assert row.stop is rule.stop
        assert row.message == rule.message


def test_claims_status_within_taxonomy(db_session: Session) -> None:
    statuses = {claim.status for claim in ReferenceRepository(db_session).claims()}
    assert statuses <= {"APROBABLE", "CONDICIONAL", "BLOQUEAR"}
