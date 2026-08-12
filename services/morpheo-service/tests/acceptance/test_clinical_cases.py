"""Acceptance tests: the twelve artifact test cases T-01…T-12 (build plan §10.1).

Each case encodes the artifact's `scenario`/`acceptance` prose into an explicit,
traceable set of engine inputs (signals + complaints). The engine only evaluates
the artifact's rules over these inputs — it invents nothing. Comments cite the
scenario so the Safety Committee can audit each translation 1:1.

Complaint phrases are copied verbatim from the modules' `entry` vocabulary.
Safety-atom names are copied verbatim from the safety rules' `when` conditions.
"""

from __future__ import annotations

import pytest

from morpheo.clinical.loader import load_clinical
from morpheo.clinical.models import ModuleId, RoleId, SafetyLevelId
from morpheo.domain.engine import AssessmentInput, evaluate_condition, run_assessment
from morpheo.domain.engine.signals import Signals, Ternary

BUNDLE = load_clinical()


def _run(inp: AssessmentInput) -> object:
    return run_assessment(inp, BUNDLE)


# T-01 — Adulto con insomnio reciente, sin deterioro. Route INS, L4/L3 según
# repercusión; el escenario dice "sin deterioro" -> L4. No diagnosticar.
def test_t01_adult_recent_insomnia_no_impairment() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=30,
            complaints=frozenset({"dificultad para conciliar"}),  # INS entry
            base_orientation=SafetyLevelId.L4,  # sin deterioro -> observación
        )
    )
    assert result.routes == frozenset({ModuleId.INS})
    assert result.level is SafetyLevelId.L4
    assert result.stop is False
    assert result.triggered_rule_ids == ()


# T-02 — Adulto con despertares + ronquido + pausas. Route INS + BRE; L2, o L1
# si deterioro marcado. Sin deterioro marcado aquí -> L2 (consulta prioritaria).
def test_t02_adult_insomnia_plus_snoring_and_apneas() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=40,
            complaints=frozenset({"despertares", "ronquido", "pausas presenciadas"}),
            # witnessed_apneas present, but no marked sleepiness/deterioration:
            # SAFE-006 = witnessed_apneas AND (marked_sleepiness OR significant_deterioration)
            # stays FALSE, so no urgent escalation.
            safety_answers={
                "witnessed_apneas": True,
                "marked_sleepiness": False,
                "significant_deterioration": False,
            },
            base_orientation=SafetyLevelId.L2,  # sospecha de AOS -> prioritaria
        )
    )
    assert result.routes == frozenset({ModuleId.INS, ModuleId.BRE})
    assert result.level is SafetyLevelId.L2
    assert result.stop is False


def test_t02_variant_marked_deterioration_escalates_to_l1() -> None:
    # "L1 si deterioro marcado": SAFE-006 fires.
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=40,
            complaints=frozenset({"despertares", "ronquido", "pausas presenciadas"}),
            safety_answers={"witnessed_apneas": True, "significant_deterioration": True},
            base_orientation=SafetyLevelId.L2,
        )
    )
    assert result.level is SafetyLevelId.L1
    assert "SAFE-006" in result.triggered_rule_ids


# T-03 — Somnolencia con casi accidente al volante. Route SLP, L1 y parada.
# Mostrar no conducir + valoración urgente antes de otras hipótesis.
def test_t03_sleepiness_driving_near_miss_l1_stop() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=35,
            complaints=frozenset({"somnolencia al volante"}),  # SLP entry
            safety_answers={"sleepiness_near_miss": True},  # SAFE-003
        )
    )
    assert result.routes == frozenset({ModuleId.SLP})
    assert result.level is SafetyLevelId.L1
    assert result.stop is True
    assert "SAFE-003" in result.triggered_rule_ids


# T-04 — Debilidad al reír + ataques de sueño. Route SLP, L2. "posible cataplejía".
def test_t04_possible_cataplexy_l2() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=28,
            complaints=frozenset({"necesidad irresistible de dormir"}),  # SLP entry
            safety_answers={
                "possible_cataplexy": True,
                "persistent_irresistible_sleep_attacks": True,
            },  # SAFE-007
            base_orientation=SafetyLevelId.L2,
        )
    )
    assert result.routes == frozenset({ModuleId.SLP})
    assert result.level is SafetyLevelId.L2
    assert result.stop is False
    assert "SAFE-007" in result.triggered_rule_ids


# T-05 — Menor de 8 años con ronquido habitual y jadeos. Usuario adulto (parent);
# route BRE; L2; valoración pediátrica; no STOP-Bang.
def test_t05_parent_child_snoring_l2() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.PARENT,
            age_years=8,
            guardianship_confirmed=True,
            complaints=frozenset({"ronquido"}),  # BRE entry
            safety_answers={"minor_habitual_snoring": True, "gasping": True},  # SAFE-008
            base_orientation=SafetyLevelId.L2,
        )
    )
    assert result.routes == frozenset({ModuleId.BRE})
    assert result.level is SafetyLevelId.L2
    assert result.stop is False
    assert "SAFE-008" in result.triggered_rule_ids


# T-06 — Lactante con pausa, coloración azulada y mala respuesta. Route seguridad
# parental; L0 y parada. Emergencia; no continuar anamnesis.
def test_t06_infant_emergency_l0_stop() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.PARENT,
            age_years=0,
            guardianship_confirmed=True,
            complaints=frozenset(),  # emergencia de seguridad, no una queja de rutina
            safety_answers={"cyanosis": True, "unresponsive": True},  # SAFE-001
        )
    )
    assert result.level is SafetyLevelId.L0
    assert result.stop is True
    assert "SAFE-001" in result.triggered_rule_ids
    assert result.routes == frozenset()  # "Seguridad parental", sin módulo clínico


# T-07 — Adolescente con horario muy tardío y sueño normal en vacaciones. Parent;
# route CIR; L3 (diario 14 días); no diagnosticar retraso de fase.
def test_t07_parent_adolescent_circadian_l3() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.PARENT,
            age_years=15,
            guardianship_confirmed=True,
            complaints=frozenset({"dormirse muy tarde"}),  # CIR entry
            base_orientation=SafetyLevelId.L3,  # diario + consulta programada
        )
    )
    assert result.routes == frozenset({ModuleId.CIR})
    assert result.level is SafetyLevelId.L3
    assert result.stop is False
    assert result.triggered_rule_ids == ()


# T-08 — Necesidad de mover piernas nocturna, alivia al caminar. Route RLS; L3.
def test_t08_rls_l3() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=45,
            complaints=frozenset({"necesidad de mover las piernas"}),  # RLS entry
            base_orientation=SafetyLevelId.L3,
        )
    )
    assert result.routes == frozenset({ModuleId.RLS})
    assert result.level is SafetyLevelId.L3
    assert result.stop is False


# T-09 — Adulto con episodio violento y lesión. Route PAR; L1. Seguridad ambiental
# y valoración urgente (SAFE-005, no parada).
def test_t09_par_violent_injurious_l1() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=50,
            complaints=frozenset({"actuar sueños"}),  # PAR entry
            safety_answers={"recent_violent_or_injurious_sleep_behavior": True},  # SAFE-005
        )
    )
    assert result.routes == frozenset({ModuleId.PAR})
    assert result.level is SafetyLevelId.L1
    assert "SAFE-005" in result.triggered_rule_ids


# T-10 — Primer episodio nocturno estereotipado con desconexión. Route PAR; L1.
# "Posible crisis" -> SAFE-004 (first_suspected_nocturnal_seizure), que además para.
def test_t10_par_first_suspected_seizure_l1() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=33,
            complaints=frozenset({"episodios estereotipados"}),  # PAR entry
            safety_answers={"first_suspected_nocturnal_seizure": True},  # SAFE-004
        )
    )
    assert result.routes == frozenset({ModuleId.PAR})
    assert result.level is SafetyLevelId.L1
    assert result.stop is True
    assert "SAFE-004" in result.triggered_rule_ids


# T-11 — Usuario desconoce si hay apneas. Route BRE; "según resto". "«Desconocido»
# no equivale a «no»": el átomo desconocido se evalúa UNKNOWN, no FALSE, y no
# suprime ni fabrica una escalada.
def test_t11_unknown_apnea_is_not_false() -> None:
    unknown_signals = Signals.from_answers({"witnessed_apneas": None, "marked_sleepiness": True})
    # The condition is genuinely UNKNOWN, never coerced to FALSE.
    assert (
        evaluate_condition(
            "witnessed_apneas AND (marked_sleepiness OR significant_deterioration)",
            unknown_signals,
        )
        is Ternary.UNKNOWN
    )

    unknown = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=40,
            complaints=frozenset({"ronquido"}),  # BRE entry
            safety_answers={"witnessed_apneas": None, "marked_sleepiness": True},
            base_orientation=SafetyLevelId.L3,
        )
    )
    assert unknown.routes == frozenset({ModuleId.BRE})
    assert unknown.level is SafetyLevelId.L3  # not downgraded by the unknown
    assert unknown.triggered_rule_ids == ()

    # The same input with the apnea *known present* escalates — the signal is live.
    known = _run(
        AssessmentInput(
            role=RoleId.ADULT,
            age_years=40,
            complaints=frozenset({"ronquido"}),
            safety_answers={"witnessed_apneas": True, "marked_sleepiness": True},
            base_orientation=SafetyLevelId.L3,
        )
    )
    assert known.level is SafetyLevelId.L1
    assert "SAFE-006" in known.triggered_rule_ids


# T-12 — Profesional introduce datos identificables. Bloqueo de privacidad;
# solicitar anonimización; no procesar en beta sin base autorizada.
def test_t12_professional_identifiable_data_privacy_block() -> None:
    result = _run(
        AssessmentInput(
            role=RoleId.PROFESSIONAL,
            professional_confirmed=True,
            contains_identifiable_data=True,
        )
    )
    assert result.privacy_block is True
    assert result.level is None
    assert result.routes == frozenset()


def test_base_orientation_rejects_urgent_levels() -> None:
    for level in (SafetyLevelId.L0, SafetyLevelId.L1):
        with pytest.raises(ValueError, match="non-urgent"):
            AssessmentInput(role=RoleId.ADULT, age_years=30, base_orientation=level)
