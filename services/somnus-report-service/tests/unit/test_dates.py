"""Readable dates in Spain's time zone, per locale."""

from __future__ import annotations

from report.rendering.dates import format_datetime


def test_spanish_long_date_in_madrid_time() -> None:
    # 01:04 UTC in October is 03:04 in Madrid (summer time).
    assert format_datetime("2026-10-17T01:04:35+00:00", "es") == "17 de octubre de 2026, 03:04"


def test_winter_time_and_other_locales() -> None:
    assert format_datetime("2026-12-03T09:30:00Z", "en") == "3 December 2026, 10:30"
    assert format_datetime("2026-12-03T09:30:00Z", "fr") == "3 décembre 2026 à 10:30"
    assert format_datetime("2026-10-17T01:04:35+00:00", "ca") == "17 d'octubre de 2026, 03:04"
    assert format_datetime("2026-03-01T12:00:00+00:00", "ca") == "1 de març de 2026, 13:00"


def test_an_unreadable_value_is_shown_as_it_came() -> None:
    assert format_datetime("not a date", "es") == "not a date"
