"""The extractor this process uses, from its settings (None: the AI is off)."""

from __future__ import annotations

import logging
from pathlib import Path

from morpheo.ai.pipeline import AiExtractor
from morpheo.ai.provider import FixtureProvider, OpenAiProvider, region_of
from morpheo.settings.config import Settings

logger = logging.getLogger("morpheo.ai")


def build_extractor(settings: Settings) -> AiExtractor | None:
    if not settings.ai_extraction_enabled:
        logger.info("AI extraction off (AI_EXTRACTION_ENABLED=false): every question is asked")
        return None
    if settings.ai_fixture_file:
        logger.info("AI extraction from recorded outputs (AI_FIXTURE_FILE): no model calls")
        return AiExtractor(FixtureProvider.from_file(Path(settings.ai_fixture_file)))
    if not settings.openai_api_key:
        logger.info("AI extraction off (no OPENAI_API_KEY): every question is asked")
        return None
    logger.info(
        "AI extraction on: model %s, OpenAI base URL %s (region %s)",
        settings.ai_model,
        settings.openai_base_url,
        region_of(settings.openai_base_url),
    )
    return AiExtractor(
        OpenAiProvider(
            api_key=settings.openai_api_key,
            model=settings.ai_model,
            base_url=settings.openai_base_url,
            timeout_seconds=settings.ai_timeout_seconds,
            reasoning_effort=settings.ai_reasoning_effort,
            temperature=settings.ai_temperature,
        )
    )
