"""Multi-label module routing."""

from __future__ import annotations

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import ModuleId
from morpheo.domain.engine import activate_modules, entry_vocabulary

MODULES = load_clinical().workflows.modules


def test_single_complaint_activates_its_module() -> None:
    assert activate_modules(MODULES, {"dificultad para conciliar"}) == frozenset({ModuleId.INS})


def test_multi_label_activation() -> None:
    routes = activate_modules(MODULES, {"despertares", "ronquido", "pausas presenciadas"})
    assert routes == frozenset({ModuleId.INS, ModuleId.BRE})


def test_no_matching_complaint_activates_nothing() -> None:
    assert activate_modules(MODULES, {"algo que no existe"}) == frozenset()
    assert activate_modules(MODULES, set()) == frozenset()


def test_every_entry_phrase_routes_to_at_least_one_module() -> None:
    vocab = entry_vocabulary(MODULES)
    assert len(vocab) > 0
    for phrase in vocab:
        assert activate_modules(MODULES, {phrase}), phrase
