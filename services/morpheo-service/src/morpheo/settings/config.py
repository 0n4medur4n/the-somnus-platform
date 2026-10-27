"""Startup configuration, validated once at boot.

Mirrors packages/config's Zod schema (build plan §20 Checkpoint 2.1): the
same env-var vocabulary (SERVICE_NAME, SERVICE_VERSION, SERVICE_COMMIT,
PORT, LOG_LEVEL, LOG_FORMAT) works across the NestJS and Python fleets.
Invalid configuration fails startup instead of running with defaults.
"""

from __future__ import annotations

import sys
from typing import Literal

from pydantic import Field, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "test", "staging", "production"]
LogLevel = Literal["debug", "info", "warn", "error"]
LogFormat = Literal["json", "text"]

# Local-dev-only default. Matches the root MySQL used by docker-compose.dev.yml.
# Never used in staging/production, where DATABASE_URL is injected from Secret Manager.
DEFAULT_LOCAL_DATABASE_URL = "mysql+pymysql://root:rootpw@127.0.0.1:3306/somnus_morpheo"


class Settings(BaseSettings):
    """Typed, validated service configuration.

    Field names are also accepted verbatim (``populate_by_name``) so tests
    can construct ``Settings(port=..., env=...)`` directly without going
    through environment variables.
    """

    model_config = SettingsConfigDict(populate_by_name=True, extra="ignore")

    service_name: str = Field(default="morpheo-service", min_length=1, alias="SERVICE_NAME")
    service_version: str = Field(default="0.0.0", min_length=1, alias="SERVICE_VERSION")
    service_commit: str = Field(default="local", min_length=1, alias="SERVICE_COMMIT")
    env: Environment = Field(default="development", alias="ENV")
    port: int = Field(default=8080, ge=0, le=65535, alias="PORT")
    log_level: LogLevel = Field(default="info", alias="LOG_LEVEL")
    log_format: LogFormat = Field(default="json", alias="LOG_FORMAT")
    database_url: str = Field(
        default=DEFAULT_LOCAL_DATABASE_URL, min_length=1, alias="DATABASE_URL"
    )
    # Morpheo v2.0, the embudo v0.2 engine (ADR 0020): the app's active flow
    # (owner and clinical lead, 19/10/2026). FUNNEL_V2_ENABLED=false rolls the
    # app back to v1 with one config change.
    funnel_v2_enabled: bool = Field(default=True, alias="FUNNEL_V2_ENABLED")
    # ISI, Epworth and STOP-Bang (D-34): their own switch, on (owner decision
    # 2026-10-19). Each official file is a clinical artifact
    # (clinical/instruments/); an instrument whose file has not arrived is
    # skipped. The directory can be overridden for tests.
    instruments_enabled: bool = Field(default=True, alias="INSTRUMENTS_ENABLED")
    instruments_source_dir: str | None = Field(default=None, alias="INSTRUMENTS_SOURCE_DIR")
    # The AI of v0.2 p. 14 (extraction from the narrative, and the risk screen):
    # on (owner decision 19/10/2026). It only runs with an OPENAI_API_KEY; with
    # the flag off or no key the interview asks every question, as before.
    ai_extraction_enabled: bool = Field(default=True, alias="AI_EXTRACTION_ENABLED")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    # The one-page report and the professional's page. Off: the result carries
    # no report and nothing changes. On: the service refuses to start unless the
    # clinical lead has signed the texts (clinical/morpheo_informe_v3.json).
    report_v3_enabled: bool = Field(default=False, alias="REPORT_V3_ENABLED")
    openai_base_url: str = Field(default="https://api.openai.com/v1", alias="OPENAI_BASE_URL")
    ai_model: str = Field(default="gpt-6-luna", min_length=1, alias="AI_EXTRACTION_MODEL")
    # Effort "none" so the low temperature applies (a reasoning model takes no
    # sampling parameters otherwise).
    ai_reasoning_effort: Literal["none", "low", "medium", "high"] = Field(
        default="none", alias="AI_EXTRACTION_REASONING_EFFORT"
    )
    ai_temperature: float = Field(default=0.0, ge=0.0, le=1.0, alias="AI_EXTRACTION_TEMPERATURE")
    # A slow model never holds the person up for long (the edge waits 25 s).
    # 12 s: at 8 s, 3 % of live calls timed out (p99 of the others 6.4 s, max
    # 7.8 s; 200-case test, 2026-10-20), each one asking S1/S4/S2 for nothing.
    ai_timeout_seconds: float = Field(default=12.0, gt=0, le=20, alias="AI_TIMEOUT_SECONDS")
    # Recorded model outputs instead of OpenAI (local runs and E2E only).
    ai_fixture_file: str | None = Field(default=None, alias="AI_FIXTURE_FILE")
    # Real patients' text may reach the model only through the EU endpoint
    # (proposal 2026-10-18 §c): with this on and a key, any other base URL
    # stops the service at startup. Set only where real patients are served.
    patient_data_allowed: bool = Field(default=False, alias="PATIENT_DATA_ALLOWED")

    @model_validator(mode="after")
    def _eu_only_for_patient_data(self) -> Settings:
        eu = "https://eu.api.openai.com/v1"
        if (
            self.patient_data_allowed
            and self.openai_api_key
            and self.openai_base_url.rstrip("/") != eu
        ):
            raise ValueError(f"PATIENT_DATA_ALLOWED=true needs OPENAI_BASE_URL={eu}")
        if self.ai_fixture_file and self.env not in ("development", "test"):
            raise ValueError("AI_FIXTURE_FILE is for local runs and tests only")
        return self


def load_settings() -> Settings:
    """Loads and validates settings from the environment.

    On invalid configuration, prints a single readable diagnostic and exits
    non-zero rather than booting with a partially-valid config or dumping a
    raw pydantic traceback.
    """
    try:
        return Settings()
    except ValidationError as exc:
        print(
            f'[config] FATAL: invalid configuration for service "morpheo-service":\n{exc}',
            file=sys.stderr,
        )
        raise SystemExit(1) from exc
