"""Startup configuration, validated once at boot.

Mirrors packages/config's Zod schema (build plan §20 Checkpoint 2.1) and the
morpheo template: the same env-var vocabulary works across the NestJS and
Python fleets. Invalid configuration fails startup instead of running with
defaults.
"""

from __future__ import annotations

import sys
from typing import Literal

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["debug", "info", "warn", "error"]
LogFormat = Literal["json", "text"]

# Local-dev-only default. The report service owns the `somnus_reporting` logical
# database (build plan §3.9 / §8); never used in staging/production, where
# DATABASE_URL is injected from Secret Manager.
DEFAULT_LOCAL_DATABASE_URL = "mysql+pymysql://root:rootpw@127.0.0.1:3306/somnus_reporting"
# The reference-corpus module's own logical database (Addendum B §B3 / ADR 0010).
# Separate from the one above on purpose: §3.9 gives each logical database its own
# user, credentials and migration history.
DEFAULT_LOCAL_CONTENT_DATABASE_URL = "mysql+pymysql://root:rootpw@127.0.0.1:3306/somnus_content"


class Settings(BaseSettings):
    """Typed, validated service configuration."""

    model_config = SettingsConfigDict(populate_by_name=True, extra="ignore")

    service_name: str = Field(default="somnus-report-service", min_length=1, alias="SERVICE_NAME")
    service_version: str = Field(default="0.0.0", min_length=1, alias="SERVICE_VERSION")
    service_commit: str = Field(default="local", min_length=1, alias="SERVICE_COMMIT")
    env: Environment = Field(default="development", alias="ENV")
    port: int = Field(default=8080, ge=0, le=65535, alias="PORT")
    log_level: LogLevel = Field(default="info", alias="LOG_LEVEL")
    log_format: LogFormat = Field(default="json", alias="LOG_FORMAT")
    database_url: str = Field(
        default=DEFAULT_LOCAL_DATABASE_URL, min_length=1, alias="DATABASE_URL"
    )
    # The reference corpus (Addendum B Phase 16), owned by the isolated corpus
    # module. A second logical database, never the same one as DATABASE_URL.
    content_database_url: str = Field(
        default=DEFAULT_LOCAL_CONTENT_DATABASE_URL, min_length=1, alias="CONTENT_DATABASE_URL"
    )
    # The private morpheo service, source of the approved clinical content (§5.5).
    morpheo_base_url: str = Field(default="http://127.0.0.1:8080", alias="MORPHEO_BASE_URL")
    # Where rendered reports are stored + the base for their signed URLs (§9).
    reports_dir: str = Field(default="./.reports", alias="REPORTS_DIR")
    report_base_url: str = Field(default="http://127.0.0.1:8081/reports", alias="REPORT_BASE_URL")
    # Signed-URL lifetime in seconds (short-lived, §9). Default 15 minutes.
    signed_url_ttl_seconds: int = Field(
        default=900, ge=60, le=86_400, alias="SIGNED_URL_TTL_SECONDS"
    )
    # Controlled AI wording (§15). Model / temperature / prompt-template version
    # are configuration, never hardcoded at call sites (§5.6). The key is a
    # secret, injected in staging/production; empty locally (adapter is mocked).
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    # GPT-6 Luna at maximum reasoning effort (owner decision 2026-10-16,
    # superseding GPT-5.6 in build plan §3.6). Temperature only applies when the
    # effort is "none": a reasoning model takes no sampling parameters.
    llm_model: str = Field(default="gpt-6-luna", min_length=1, alias="LLM_MODEL")
    llm_reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = Field(
        default="max", alias="LLM_REASONING_EFFORT"
    )
    llm_temperature: float = Field(default=0.2, ge=0.0, le=2.0, alias="LLM_TEMPERATURE")
    llm_prompt_template_version: str = Field(
        default="rewrite_v1", min_length=1, alias="LLM_PROMPT_TEMPLATE_VERSION"
    )
    # Master switch for AI wording (§15). ON by default, everywhere (owner
    # decision 2026-10-16). Safe to be on: only HUMAN-APPROVED rewordings of the
    # report's fixed sentences are ever printed (per-text review queue), and a
    # sentence without one prints exactly as Morpheo approved it. Set to false
    # to print every report deterministically and never consult the queue.
    # See report.application.ai_wording.
    ai_rewrite_enabled: bool = Field(default=True, alias="AI_REWRITE_ENABLED")
    # Embeddings for explanation-only clinical grounding (build plan §3.6b). The
    # dimensions are fixed at the model default (3072); reducing them requires a
    # documented decision. Used only over the approved corpus — never on the
    # decision path (§14b). The key is the same OPENAI_API_KEY (empty locally).
    embedding_model: str = Field(
        default="text-embedding-3-large", min_length=1, alias="EMBEDDING_MODEL"
    )
    embedding_dimensions: int = Field(default=3072, ge=1, le=3072, alias="EMBEDDING_DIMENSIONS")


def load_settings() -> Settings:
    """Loads and validates settings from the environment, or exits non-zero."""
    try:
        return Settings()
    except ValidationError as exc:
        print(
            f'[config] FATAL: invalid configuration for service "somnus-report-service":\n{exc}',
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
