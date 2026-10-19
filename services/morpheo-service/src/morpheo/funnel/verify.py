"""The final text adds nothing beyond the engine's result (v0.2 p. 14).

«… generar texto desde resultados → comprobar que el texto no añade hechos o
consejos ajenos al motor.» Two checks on every result:

* each paragraph belongs to an orientation the rules decided (or the S2
  warning that goes with T_SOMNOLENCIA);
* every word of it comes from a v0.2 template, an approved catalogue phrase,
  draft or frame, or a resource (112, 024). What is left once those are taken
  out may only be punctuation, spaces, numbers and units -- the person's
  confirmed counts and durations.

The texts are built that way today, so this never fires; it is the guard that
fails loudly if a paragraph is ever written, or rewritten, by anything else.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from morpheo.funnel.artifact import FunnelArtifact
from morpheo.funnel.catalogue import Catalogue

_SLOT = re.compile(r"\{[^}]+\}")
_PLACEHOLDER = re.compile(r"\[[^\]]+\]")
_NO_DATA = re.compile(r"\[[^\]]+: sin dato\]")
_UNITS = ("días", "día", "semanas", "semana", "meses", "mes", "años", "año", "horas", "hora")
# Punctuation, spaces and digits (en and em dashes written as escapes).
_RESIDUE = re.compile(r"^[\s\d.,;:()«»¿?¡!\-\u2013\u2014/\"']*$")
EXTRA_TEMPLATES = {"T_SOMNOLENCIA": "S2_aviso"}


def _pieces(texts: Iterable[str], pattern: re.Pattern[str]) -> list[str]:
    out: list[str] = []
    for text in texts:
        unquoted = text.replace("«", "").replace("»", "")
        out += [p.strip() for p in pattern.split(unquoted) if p.strip()]
    return out


_CACHE: dict[tuple[int, int], tuple[str, ...]] = {}


def _fragments(artifact: FunnelArtifact, catalogue: Catalogue) -> tuple[str, ...]:
    key = (id(artifact), id(catalogue))
    if key not in _CACHE:
        _CACHE[key] = _collect(artifact, catalogue)
    return _CACHE[key]


def _collect(artifact: FunnelArtifact, catalogue: Catalogue) -> tuple[str, ...]:
    fragments = _pieces(artifact.templates.values(), _PLACEHOLDER)
    fragments += _pieces((p.text for lst in catalogue.lists.values() for p in lst.phrases), _SLOT)
    fragments += _pieces((d.text for d in catalogue.drafts.values()), _SLOT)
    for slots in catalogue.placeholders.values():
        fragments += _pieces((s.frame for s in slots.values() if s.frame), _SLOT)
        fragments += [s.empty for s in slots.values() if s.empty]
    fragments += [
        v for k, v in artifact.engine["resources"].items() if k != "default" and isinstance(v, str)
    ]
    fragments += [lst.joiner.strip() for lst in catalogue.lists.values() if lst.joiner]
    fragments += [" y "]
    # Longest first, so a phrase is taken whole before any shorter piece of it.
    return tuple(sorted({f.casefold() for f in fragments if f}, key=len, reverse=True))


def unexplained(text: str, artifact: FunnelArtifact, catalogue: Catalogue) -> str:
    """What is left of a paragraph once every approved fragment is taken out."""
    rest = _NO_DATA.sub(" ", text).replace("«", "").replace("»", "").casefold()
    for fragment in _fragments(artifact, catalogue):
        rest = rest.replace(fragment, " ")
    for unit in _UNITS:
        rest = re.sub(rf"\b{unit}\b", " ", rest)
    return "" if _RESIDUE.match(rest) else " ".join(rest.split())


def verify(
    artifact: FunnelArtifact,
    catalogue: Catalogue,
    texts: Iterable[tuple[str, str]],
    templates: Iterable[str | None],
) -> list[str]:
    """The problems with a result's texts (empty when it adds nothing)."""
    decided = {t for t in templates if t}
    allowed = decided | {EXTRA_TEMPLATES[t] for t in decided if t in EXTRA_TEMPLATES}
    problems: list[str] = []
    for template, text in texts:
        if template not in allowed:
            problems.append(f"{template}: no orientation of the engine asked for it")
        left = unexplained(text, artifact, catalogue)
        if left:
            problems.append(f"{template}: not from a template or the catalogue: {left!r}")
    return problems


__all__ = ["unexplained", "verify"]
