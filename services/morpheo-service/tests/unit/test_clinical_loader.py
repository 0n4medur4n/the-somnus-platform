"""Checkpoint 10.0: the clinical artifact loader validates the real artifacts
and rejects drift. No engine logic is exercised here."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from morpheo.clinical import (
    ClaimStatus,
    ClinicalArtifactError,
    ModuleId,
    RoleId,
    SafetyLevelId,
    load_claims_csv,
    load_clinical,
    load_workflows,
)
from morpheo.clinical.loader import (
    CLAIMS_CSV_FILE,
    SAFETY_PROMPTS_FILE,
    WORKFLOWS_FILE,
    clinical_bundle,
)
from morpheo.clinical.version import CONTENT_VERSION, WORKFLOW_VERSION


def _real_json() -> dict[str, Any]:
    return json.loads(WORKFLOWS_FILE.read_text(encoding="utf-8"))


def _real_prompts() -> dict[str, Any]:
    return json.loads(SAFETY_PROMPTS_FILE.read_text(encoding="utf-8"))


def _write(tmp_path: Path, data: dict[str, Any]) -> Path:
    target = tmp_path / "morpheo_workflows_mutated.json"
    target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return target


def _write_prompts(tmp_path: Path, data: dict[str, Any]) -> Path:
    target = tmp_path / "morpheo_safety_prompts_mutated.json"
    target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return target


# --- The real artifacts load and are internally consistent ---


def test_real_artifacts_load_and_match_the_spec_counts() -> None:
    bundle = load_clinical()
    wf = bundle.workflows
    assert [r.id for r in wf.roles] == [RoleId.ADULT, RoleId.PARENT, RoleId.PROFESSIONAL]
    assert {m.id for m in wf.modules} == set(ModuleId)
    assert {lv.id for lv in wf.safety_levels} == set(SafetyLevelId)
    assert len(wf.state_machine) == 11
    assert len(wf.core_questions) == 9
    assert len(wf.safety_rules) == 9
    assert len(wf.sources) == 15
    assert len(wf.test_cases) == 12


def test_twelve_claims_parse_from_json_and_csv_and_agree() -> None:
    bundle = load_clinical()
    csv_claims = bundle.claims_csv
    json_claims = bundle.workflows.claims_registry
    assert len(csv_claims) == 12
    assert len(json_claims) == 12
    assert {c.id for c in csv_claims} == {c.id for c in json_claims}
    # Every status is within the fixed taxonomy, and BLOQUEAR claims exist
    # (they feed the forbidden-phrase scanner in a later checkpoint).
    assert all(isinstance(c.status, ClaimStatus) for c in csv_claims)
    assert any(c.status is ClaimStatus.BLOQUEAR for c in csv_claims)


def test_versions_are_read_from_the_artifact() -> None:
    bundle = load_clinical()
    # The rule/spec version is unchanged; content_version was bumped when the
    # safety-signal questions were added (content-only change, §14a).
    assert bundle.workflow_version == "1.0"
    assert bundle.content_version == "1.3"
    assert WORKFLOW_VERSION == "1.0"
    assert CONTENT_VERSION == "1.3"


def test_clinical_bundle_is_cached() -> None:
    assert clinical_bundle() is clinical_bundle()


def test_claims_csv_loads_the_twelve_rows() -> None:
    assert len(load_claims_csv(CLAIMS_CSV_FILE)) == 12


# --- Drift is rejected loudly (build plan §10.0) ---


def test_rejects_missing_rule_field(tmp_path: Path) -> None:
    data = _real_json()
    del data["safety_rules"][0]["level"]  # a rule missing required data
    with pytest.raises(ClinicalArtifactError):
        load_workflows(_write(tmp_path, data))


def test_rejects_bad_safety_level(tmp_path: Path) -> None:
    data = _real_json()
    data["safety_rules"][0]["level"] = "L9"  # outside L0-L4
    with pytest.raises(ClinicalArtifactError):
        load_workflows(_write(tmp_path, data))


def test_rejects_unknown_state_transition(tmp_path: Path) -> None:
    data = _real_json()
    data["state_machine"][0]["next"] = "NOWHERE"
    with pytest.raises(ClinicalArtifactError):
        load_workflows(_write(tmp_path, data))


def test_rejects_unexpected_key(tmp_path: Path) -> None:
    data = _real_json()
    data["safety_rules"][0]["surprise"] = "unexpected"  # extra="forbid"
    with pytest.raises(ClinicalArtifactError):
        load_workflows(_write(tmp_path, data))


def test_rejects_dangling_source_reference(tmp_path: Path) -> None:
    data = _real_json()
    data["modules"][0]["sources"] = ["SRC-99"]  # no such source
    with pytest.raises(ClinicalArtifactError):
        load_workflows(_write(tmp_path, data))


def test_rejects_unknown_module_id(tmp_path: Path) -> None:
    data = _real_json()
    data["modules"][0]["id"] = "ZZZ"  # outside the fixed module taxonomy
    with pytest.raises(ClinicalArtifactError):
        load_workflows(_write(tmp_path, data))


def test_rejects_invalid_json(tmp_path: Path) -> None:
    broken = tmp_path / "broken.json"
    broken.write_text("{ not json", encoding="utf-8")
    with pytest.raises(ClinicalArtifactError):
        load_workflows(broken)


def test_rejects_claims_mismatch_between_json_and_csv(tmp_path: Path) -> None:
    data = _real_json()
    data["claims_registry"][0]["id"] = "CLM-999"  # diverge from the CSV
    with pytest.raises(ClinicalArtifactError):
        load_clinical(_write(tmp_path, data), CLAIMS_CSV_FILE)


# --- Safety-signal questions: every rule signal has exactly one question ---


def test_safety_prompts_cover_every_rule_signal_once() -> None:
    # load_clinical succeeding already enforces the bijection (prompt ids ==
    # rule signal atoms); here we pin the count and the pediatric-context set.
    bundle = load_clinical()
    prompts = bundle.safety_prompts.prompts
    assert len(prompts) == 22
    assert len({p.signal_id for p in prompts}) == 22
    pediatric = {p.signal_id for p in prompts if p.context.value == "pediatric"}
    assert pediatric == {
        "minor_habitual_snoring",
        "gasping",
        "labored_breathing",
        "daytime_behavior_learning_growth_concern",
    }


def test_rejects_missing_safety_prompt(tmp_path: Path) -> None:
    data = _real_prompts()
    data["prompts"] = data["prompts"][:-1]  # drop one -> a rule signal has no question
    with pytest.raises(ClinicalArtifactError):
        load_clinical(WORKFLOWS_FILE, CLAIMS_CSV_FILE, _write_prompts(tmp_path, data))


def test_rejects_safety_prompt_for_unknown_signal(tmp_path: Path) -> None:
    data = _real_prompts()
    data["prompts"][0]["signal_id"] = "not_a_real_signal"
    with pytest.raises(ClinicalArtifactError):
        load_clinical(WORKFLOWS_FILE, CLAIMS_CSV_FILE, _write_prompts(tmp_path, data))
