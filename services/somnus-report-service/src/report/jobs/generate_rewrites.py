"""Propose AI rewordings for review: the explicit entry point (build plan §15).

    python -m report.jobs.generate_rewrites

For every fixed sentence the AI may reword (report.application.ai_wording) that
has no pending or approved rewording yet, asks the configured model (GPT-6 Luna
at its highest reasoning effort, xhigh, by default) for one and queues it as
`pending_review`. A human approves or rejects it in the admin console; only then
can a report print it. A candidate the forbidden-phrase scanner blocks is logged
and never queued.

**Never on boot, never per report.** It runs by hand, as a deploy step, after a
`content_version` bump -- the same discipline as `index_sources`, for the same
reasons (min instances 0; a bill per cold start; nondeterministic state). Only
Morpheo's approved sentences are sent to the model: no person, no answer, no
health data about anyone.

Safe to repeat: a sentence that already has a pending or approved rewording is
skipped, so a second run costs nothing. A rejected one gets a fresh proposal.

Prints one JSON line of counts. Never prints the key, the database URL, or any
sentence.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Callable
from dataclasses import asdict, dataclass

from sqlalchemy.orm import Session, sessionmaker

from report.application.ai_wording import rewritable_texts
from report.application.content_review import ContentReviewService
from report.application.rewriter import PENDING_REVIEW, Rewriter
from report.infrastructure.db import create_engine_from_url
from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.llm.openai_adapter import OpenAiAdapter
from report.infrastructure.llm.openai_endpoint import endpoint_line
from report.infrastructure.llm.provider import LlmProvider
from report.infrastructure.morpheo_client import ContentProvider, MorpheoContentClient
from report.repositories.content_review_repository import ContentReviewRepositorySql
from report.settings.config import Settings, load_settings

PROMPT_TEMPLATE_ID = "rewrite_plain_language"


class ModelNotConfiguredError(RuntimeError):
    """A rewording was needed and no OPENAI_API_KEY is configured."""


@dataclass(frozen=True)
class GenerationResult:
    content_version: str
    sentences: int
    already_covered: int
    queued: int
    blocked: int


def run_generation(
    *,
    settings: Settings,
    content: ContentProvider,
    provider: LlmProvider | None,
    session_factory: Callable[[], Session],
) -> GenerationResult:
    clinical = content.get_content()
    scanner = ForbiddenPhraseScanner(
        forbidden_phrases=list(clinical.output_contract.forbidden_phrases),
        blocked_claims=list(clinical.blocked_claims),
    )
    version = settings.llm_prompt_template_version
    texts = rewritable_texts(clinical)
    covered = queued = blocked = 0

    for entry in texts:
        with session_factory() as session:
            review = ContentReviewService(ContentReviewRepositorySql(session))
            if not review.needs_candidate(entry.text, prompt_template_version=version):
                covered += 1
                continue
        if provider is None:
            raise ModelNotConfiguredError(
                "a sentence needs a rewording and OPENAI_API_KEY is not configured"
            )
        rewriter = Rewriter(
            provider,
            scanner,
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            reasoning_effort=settings.llm_reasoning_effort,
            template_version=version,
            prompt_template_id=PROMPT_TEMPLATE_ID,
        )
        result = rewriter.rewrite(entry.text)
        if result.review_status != PENDING_REVIEW or result.text is None:
            blocked += 1
            continue
        with session_factory() as session:
            review = ContentReviewService(ContentReviewRepositorySql(session))
            item = review.enqueue(
                text_ref=entry.text_ref,
                deterministic_text=entry.text,
                candidate_text=result.text,
                scanner=scanner,
                model_id=settings.llm_model,
                prompt_template_version=version,
                prompt_template_id=PROMPT_TEMPLATE_ID,
            )
            session.commit()
        if item is None:
            blocked += 1
        else:
            queued += 1

    return GenerationResult(
        content_version=clinical.content_version,
        sentences=len(texts),
        already_covered=covered,
        queued=queued,
        blocked=blocked,
    )


def main() -> int:
    settings = load_settings()
    # stderr: stdout carries the job's JSON result.
    endpoint = endpoint_line(enabled=bool(settings.openai_api_key))
    print(f"[generate_rewrites] {endpoint}", file=sys.stderr)
    engine = create_engine_from_url(settings.database_url)
    try:
        result = run_generation(
            settings=settings,
            content=MorpheoContentClient(settings.morpheo_base_url),
            provider=OpenAiAdapter(settings.openai_api_key) if settings.openai_api_key else None,
            session_factory=sessionmaker(bind=engine, expire_on_commit=False),
        )
    except Exception as exc:
        # Only the type and message: every message raised on this path is safe to
        # print, and a traceback of locals could carry a sentence or the key.
        print(f"[generate_rewrites] refused: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print(json.dumps({"job": "generate_rewrites", **asdict(result)}))
    return 0


if __name__ == "__main__":  # pragma: no cover - operator entry point
    raise SystemExit(main())
