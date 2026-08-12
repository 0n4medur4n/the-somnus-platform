from __future__ import annotations

import pytest
from pydantic import ValidationError

from morpheo.settings.config import Settings


def test_settings_defaults_are_valid() -> None:
    settings = Settings(_env_file=None)
    assert settings.service_name == "morpheo-service"
    assert settings.service_version == "0.0.0"
    assert settings.env == "development"
    assert settings.port == 8080
    assert settings.log_level == "info"
    assert settings.log_format == "json"


@pytest.mark.parametrize(
    "overrides",
    [
        {"port": -1},
        {"port": 70000},
        {"env": "not-a-real-environment"},
        {"log_level": "verbose"},
        {"log_format": "xml"},
        {"service_name": ""},
    ],
)
def test_settings_rejects_invalid_shape(overrides: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **overrides)
