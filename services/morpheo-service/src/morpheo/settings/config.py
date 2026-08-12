"""Startup configuration, validated once at boot.

Mirrors packages/config's Zod schema (build plan §20 Checkpoint 2.1): the
same env-var vocabulary (SERVICE_NAME, SERVICE_VERSION, SERVICE_COMMIT,
PORT, LOG_LEVEL, LOG_FORMAT) works across the NestJS and Python fleets.
Invalid configuration fails startup instead of running with defaults.
"""

from __future__ import annotations

import sys
from typing import Literal

from pydantic import Field, ValidationError
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
