"""Report layout i18n completeness (build plan §12: a missing key fails CI)."""

from __future__ import annotations

from report.rendering.i18n import strings_for


def test_all_locales_share_the_reference_keys() -> None:
    reference = set(strings_for("es"))
    assert reference  # non-empty
    for locale in ("en", "ca", "fr"):
        assert set(strings_for(locale)) == reference, f"{locale} layout keys differ from es"
