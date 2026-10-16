"""Which sentences AI may reword, how approvals apply, and the generation job.

Per-text review (2026-10-16): the AI rewords the report's fixed sentences, each
reviewed once by a human; only an approved rewording is ever used.
"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from report.application.ai_wording import apply_approved_wording, rewritable_texts
from report.application.content_review import (
    STATUS_APPROVED,
    STATUS_REJECTED,
    ContentReviewService,
)
from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.schemas.render import ClinicalContentDTO

VERSION = "rewrite_v1"
SCANNER = ForbiddenPhraseScanner(forbidden_phrases=[], blocked_claims=[])
SERVICE = Path(__file__).resolve().parents[2]


def _queue(service: ContentReviewService, text: str, candidate: str) -> str:
    item = service.enqueue(
        text_ref="module:INS",
        deterministic_text=text,
        candidate_text=candidate,
        scanner=SCANNER,
        model_id="gpt-6-luna",
        prompt_template_version=VERSION,
        prompt_template_id="rewrite_plain_language",
    )
    assert item is not None
    return item.item_id


def test_patterns_and_non_urgent_levels_are_rewordable_urgent_ones_never(
    content: ClinicalContentDTO,
) -> None:
    refs = {entry.text_ref for entry in rewritable_texts(content)}
    assert {"module:INS", "level:L4"} <= refs
    # Emergency and urgent instructions keep Morpheo's exact words.
    assert "level:L0" not in refs
    assert "level:L1" not in refs


def test_only_the_approved_rewording_is_returned_per_text(
    make_review_service: Callable[[], ContentReviewService],
) -> None:
    service = make_review_service()
    text = "Has comunicado un patrón de dificultad para dormir."
    item_id = _queue(service, text, "Te cuesta dormir.")
    assert service.approved_rewrite(text, prompt_template_version=VERSION) is None  # pending
    assert service.needs_candidate(text, prompt_template_version=VERSION) is False

    service.decide(item_id, status=STATUS_APPROVED, reviewer_id="rev-1", reason="fiel")
    assert service.approved_rewrite(text, prompt_template_version=VERSION) == "Te cuesta dormir."
    # Matched by the exact sentence and template version: anything else is unreviewed.
    assert service.approved_rewrite(text + " ", prompt_template_version=VERSION) is None
    assert service.approved_rewrite(text, prompt_template_version="rewrite_v2") is None


def test_a_rejected_rewording_frees_the_sentence_for_a_new_proposal(
    make_review_service: Callable[[], ContentReviewService],
) -> None:
    service = make_review_service()
    text = "Has comunicado somnolencia diurna que conviene valorar."
    item_id = _queue(service, text, "Tienes narcolepsia.")
    service.decide(item_id, status=STATUS_REJECTED, reviewer_id="rev-1", reason="diagnostica")
    assert service.approved_rewrite(text, prompt_template_version=VERSION) is None
    assert service.needs_candidate(text, prompt_template_version=VERSION) is True


def test_applying_wording_swaps_only_approved_sentences(content: ClinicalContentDTO) -> None:
    approved = {"Has comunicado un patrón de dificultad para dormir.": "Te cuesta dormir."}

    class _Wording:
        def approved_rewrite(self, deterministic_text: str) -> str | None:
            return approved.get(deterministic_text)

    worded = apply_approved_wording(content, _Wording())
    outputs = {module.id: module.output for module in worded.modules}
    assert outputs["INS"] == "Te cuesta dormir."
    assert outputs["SLP"] == "Has comunicado somnolencia diurna que conviene valorar."
    # Ids, names and levels -- the decision -- are untouched.
    assert [m.id for m in worded.modules] == [m.id for m in content.modules]
    assert [(lv.id, lv.name) for lv in worded.safety_levels] == [
        (lv.id, lv.name) for lv in content.safety_levels
    ]


def test_the_generation_job_never_runs_on_boot() -> None:
    probe = (
        "import json, sys; import report.main; "
        "print(json.dumps(sorted(m for m in sys.modules if m.startswith('report.'))))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=SERVICE,
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )
    assert "report.jobs.generate_rewrites" not in completed.stdout
    assert "generate_rewrites" not in (SERVICE / "Dockerfile").read_text(encoding="utf-8")
