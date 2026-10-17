"""Dates as a person reads them, in Spain's time zone (es/en/ca/fr).

Layout, not clinical content: month names and word order per locale. The time
zone is Europe/Madrid -- the service is for Spain; `tzdata` ships the database
so it is the same on every machine.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("Europe/Madrid")

_MONTHS = {
    "es": [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ],
    "en": [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ],
    "ca": [
        "gener",
        "febrer",
        "març",
        "abril",
        "maig",
        "juny",
        "juliol",
        "agost",
        "setembre",
        "octubre",
        "novembre",
        "desembre",
    ],
    "fr": [
        "janvier",
        "février",
        "mars",
        "avril",
        "mai",
        "juin",
        "juillet",
        "août",
        "septembre",
        "octobre",
        "novembre",
        "décembre",
    ],
}


def format_datetime(iso: str, locale: str) -> str:
    """'2026-10-17T01:04:35+00:00' -> '17 de octubre de 2026, 03:04' (es)."""
    try:
        moment = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return iso
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    local = moment.astimezone(ZONE)
    month = _MONTHS.get(locale, _MONTHS["es"])[local.month - 1]
    time = f"{local.hour:02d}:{local.minute:02d}"
    if locale == "en":
        return f"{local.day} {month} {local.year}, {time}"
    if locale == "fr":
        return f"{local.day} {month} {local.year} à {time}"
    if locale == "ca":
        prefix = "d'" if month[0] in "aeiouà" else "de "
        return f"{local.day} {prefix}{month} de {local.year}, {time}"
    return f"{local.day} de {month} de {local.year}, {time}"
