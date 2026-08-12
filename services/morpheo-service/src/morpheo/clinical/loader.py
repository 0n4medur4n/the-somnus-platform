"""Load + validate the Morpheo source artifacts (build plan §20 Checkpoint 10.0).

The loader parses `morpheo_workflows_v1.json` and `morpheo_claims_registry_v1.csv`
through the strict models in models.py and then runs cross-reference integrity
checks. It **fails loudly** on any schema drift — a missing/invalid field, a
value outside the fixed taxonomy, a transition to an unknown state, a dangling
source reference, or a mismatch between the CSV and the JSON claim set — so a
broken artifact can never be silently loaded. No engine logic lives here.
"""

from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path

from pydantic import ValidationError

from .models import ClaimRecord, MorpheoWorkflows

# The artifacts live with the service (build plan §14a), four directories up
# from this file: src/morpheo/clinical/loader.py -> <service root>/clinical.
CLINICAL_DIR = Path(__file__).resolve().parents[3] / "clinical"
WORKFLOWS_FILE = CLINICAL_DIR / "morpheo_workflows_v1.json"
CLAIMS_CSV_FILE = CLINICAL_DIR / "morpheo_claims_registry_v1.csv"

# Terminal transition targets that are not themselves source states in the
# machine (build plan §14a: SAFETY_GATE -> ESCALATED, OUTPUT_READY -> END).
_TERMINAL_STATES = frozenset({"ESCALATED", "END"})


class ClinicalArtifactError(ValueError):
    """Raised when an artifact fails to parse or violates an integrity rule."""


class ClinicalBundle:
    """The validated pair of artifacts, plus the versions stamped on outputs."""

    __slots__ = ("_claims_csv", "_workflows")

    def __init__(self, workflows: MorpheoWorkflows, claims_csv: tuple[ClaimRecord, ...]) -> None:
        self._workflows = workflows
        self._claims_csv = claims_csv

    @property
    def workflows(self) -> MorpheoWorkflows:
        return self._workflows

    @property
    def claims_csv(self) -> tuple[ClaimRecord, ...]:
        return self._claims_csv

    @property
    def workflow_version(self) -> str:
        return self._workflows.meta.version

    @property
    def content_version(self) -> str:
        # The artifact carries a single `meta.version`; the build plan's
        # workflow_version and content_version both bind to it (a change to any
        # artifact is one content-version bump reviewed by the Safety Committee).
        return self._workflows.meta.version


def load_workflows(path: Path = WORKFLOWS_FILE) -> MorpheoWorkflows:
    """Parse + validate the workflows JSON, then check referential integrity."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ClinicalArtifactError(f"{path.name} is not valid JSON: {exc}") from exc
    try:
        workflows = MorpheoWorkflows.model_validate(raw)
    except ValidationError as exc:
        raise ClinicalArtifactError(f"{path.name} failed schema validation:\n{exc}") from exc

    _check_integrity(workflows)
    return workflows


def load_claims_csv(path: Path = CLAIMS_CSV_FILE) -> tuple[ClaimRecord, ...]:
    """Parse + validate the claims CSV (utf-8-sig: the file carries a BOM)."""
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    try:
        claims = tuple(ClaimRecord.model_validate(row) for row in rows)
    except ValidationError as exc:
        raise ClinicalArtifactError(f"{path.name} failed schema validation:\n{exc}") from exc
    return claims


def load_clinical(
    workflows_path: Path = WORKFLOWS_FILE,
    claims_path: Path = CLAIMS_CSV_FILE,
) -> ClinicalBundle:
    """Load both artifacts and verify they agree on the claim set."""
    workflows = load_workflows(workflows_path)
    claims = load_claims_csv(claims_path)

    json_ids = {claim.id for claim in workflows.claims_registry}
    csv_ids = {claim.id for claim in claims}
    if json_ids != csv_ids:
        raise ClinicalArtifactError(
            "claims registry mismatch between JSON and CSV: "
            f"only in JSON={sorted(json_ids - csv_ids)}, only in CSV={sorted(csv_ids - json_ids)}"
        )
    return ClinicalBundle(workflows=workflows, claims_csv=claims)


@lru_cache(maxsize=1)
def clinical_bundle() -> ClinicalBundle:
    """The committed artifacts, loaded and validated once per process."""
    return load_clinical()


def _check_integrity(workflows: MorpheoWorkflows) -> None:
    """Cross-reference invariants beyond per-field schema validation."""
    source_ids = {source.id for source in workflows.sources}
    level_ids = {level.id for level in workflows.safety_levels}
    declared_states = {transition.state for transition in workflows.state_machine}
    valid_targets = declared_states | _TERMINAL_STATES

    for transition in workflows.state_machine:
        if transition.next not in valid_targets:
            raise ClinicalArtifactError(
                f"state_machine: transition {transition.state!r} -> {transition.next!r} "
                "targets an unknown state"
            )

    for rule in workflows.safety_rules:
        if rule.level not in level_ids:
            raise ClinicalArtifactError(
                f"safety rule {rule.id!r} references undefined safety level {rule.level!r}"
            )
        _check_sources(rule.id, rule.sources, source_ids)

    for module in workflows.modules:
        _check_sources(module.id.value, module.sources, source_ids)


def _check_sources(owner: str, refs: list[str], source_ids: set[str]) -> None:
    for ref in refs:
        if ref not in source_ids:
            raise ClinicalArtifactError(f"{owner!r} cites unknown clinical source {ref!r}")
