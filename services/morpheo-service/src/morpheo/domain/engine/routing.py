"""Multi-label module routing (build plan §14a).

A module activates when any of the patient's reported complaints matches one of
its `entry` conditions. Several modules can activate at once (INS + BRE, …). The
complaint vocabulary is the artifact's own `entry` phrases — the engine matches
against them, it does not invent categories.
"""

from __future__ import annotations

from collections.abc import Iterable

from morpheo.clinical.models import Module, ModuleId


def entry_vocabulary(modules: Iterable[Module]) -> frozenset[str]:
    """Every complaint phrase any module can be entered by."""
    return frozenset(phrase for module in modules for phrase in module.entry)


def activate_modules(modules: Iterable[Module], complaints: Iterable[str]) -> frozenset[ModuleId]:
    """The set of modules whose entry conditions intersect the complaints."""
    selected = set(complaints)
    return frozenset(module.id for module in modules if selected.intersection(module.entry))
