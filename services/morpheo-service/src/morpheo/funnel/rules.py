"""Rules R01-R08 of the embudo v0.2 (p. 13), with the DEFAULTs D-xx.

Pure and deterministic: the same confirmed answers always give the same
alerts, orientations and text (p. 14: "Las reglas deben vivir fuera del
generador de lenguaje"). Unknown is never "no" (R03): every condition below
reads `None` as "not known" and, where a choice is needed, takes the path that
leads to a consultation rather than to self-help (D-xx).

The text comes only from the v0.2 templates (pp. 11-12); placeholders are
filled with the person's confirmed answers, never written by a model.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact, FunnelArtifactError
from morpheo.funnel.instruments import InstrumentOutcome, outcomes
from morpheo.funnel.interview import (
    NO,
    S2_PAUSED,
    SAFETY,
    YES,
    Answer,
    Interview,
    chronic_from_core,
)
from morpheo.instruments.definitions import InstrumentRegistry


@dataclass(frozen=True)
class Orientation:
    category: str
    template: str | None
    rule: str
    why: str


@dataclass(frozen=True)
class FunnelResult:
    stopped_by: str | None
    alerts: tuple[str, ...]
    orientations: tuple[Orientation, ...]
    accion_principal: str | None
    acciones_asociadas: tuple[str, ...]
    prueba_a_valorar: str | None
    rule_ids: tuple[str, ...]
    datos_pendientes: tuple[str, ...]
    flags: tuple[str, ...]
    texts: tuple[tuple[str, str], ...]
    version_reglas: str
    trace: tuple[str, ...] = field(default=())
    # The catalogue phrases the texts used, by id (for clinical review).
    phrase_ids: tuple[str, ...] = field(default=())
    # The validated instruments offered (scores never feed the rules above).
    instruments: tuple[InstrumentOutcome, ...] = field(default=())
    # v0.2 p. 14, shown with any score: no scale confirms apnoea.
    instruments_note: str | None = None


def _labels(iv: Interview, step_id: str, chosen: Any) -> list[str]:
    definition = iv._first(step_id)
    if definition is None or not isinstance(chosen, list):
        return []
    by_key = {o.key: o.label for o in definition.options}
    return [by_key[k] for k in chosen if k in by_key]


def _instruments_note(artifact: FunnelArtifact) -> str:
    text: str = artifact.raw["source"]["instruments"]["text"]
    found = re.search(r"Ninguna escala[^.]*\.", text)
    assert found is not None, "v0.2 p. 14 lost its sentence on scales"
    return found.group(0)


def evaluate(
    artifact: FunnelArtifact,
    answers: Mapping[str, Answer],
    instruments: InstrumentRegistry | None = None,
) -> FunnelResult:
    """R01-R08 on the confirmed answers, then the instruments' outcome beside them."""
    result = _evaluate(artifact, answers)
    iv = Interview(artifact, answers)

    def value_of(key: str) -> object:
        given = answers.get(key)
        return None if given is None else given.value

    found = outcomes(instruments, iv, value_of)
    if not found:
        return result
    trace = [
        f"Instrumento {o.code}: {o.status}"
        + (f" · {o.total} · {o.band}" if o.total is not None else "")
        + (f" · {o.placement}")
        for o in found
    ]
    scored = any(o.status == "completed" for o in found)
    return replace(
        result,
        instruments=found,
        instruments_note=_instruments_note(artifact) if scored else None,
        trace=(*result.trace, *trace),
    )


def _evaluate(artifact: FunnelArtifact, answers: Mapping[str, Answer]) -> FunnelResult:
    iv = Interview(artifact, answers)
    v, s = iv.value, iv.safety
    trace: list[str] = []
    orientations: list[Orientation] = []
    alerts: list[str] = []
    flags: list[str] = []
    pending: list[str] = []
    rules: list[str] = []

    def orient(category: str, template: str | None, rule: str, why: str) -> None:
        orientations.append(Orientation(category, template, rule, why))
        if rule not in rules:
            rules.append(rule)
        trace.append(f"{rule}: {category}{f' → {template}' if template else ''} ({why})")

    stopped = iv.stopped()

    # --- R02: age (p. 13; D-33) ---
    if stopped == "AGE_MENOR":
        rules.append("R02")
        trace.append("R02: edad < 18 → RUTA_PEDIATRICA (fuera de alcance; D-33)")
        return _result(artifact, stopped, ["RUTA_PEDIATRICA"], [], [], [], ["R02"], trace, iv=iv)
    if stopped == "AGE_DESCONOCIDA":
        trace.append("R02: edad desconocida tras aclarar → INFORMACION_INSUFICIENTE")
        orient("INFORMACION_INSUFICIENTE", "T_INCOMPLETO", "R02", "edad desconocida")
        return _result(artifact, stopped, [], orientations, ["AGE"], [], rules, trace, iv=iv)

    # --- R01: alerts (p. 13; D-03, D-04, D-05, D-13) ---
    if s("S1") == YES:
        alerts.append("EMERGENCIA")
        orient("EMERGENCIA", "T_SEGURIDAD", "R01", "S1 = Sí")
    if s("S4") == YES:
        alerts.append("EMERGENCIA")
        orient(
            "EMERGENCIA", "T_SEGURIDAD", "R01", "S4 = Sí (D-03: cualquier Sí es peligro inmediato)"
        )
    if stopped == S2_PAUSED:
        # p. 10: not in a safe place after an S2 "Sí" -- pause, keep the warning.
        alerts.append("EVALUACION_PRIORITARIA")
        orient(
            "EVALUACION_PRIORITARIA",
            "T_SOMNOLENCIA",
            "R01",
            "S2 = Sí: conducción o tarea de riesgo",
        )
        orient(
            "EVALUACION_PRIORITARIA", "S2_pausa", "R01", "S2: no está en un lugar seguro (p. 10)"
        )
        return _result(artifact, stopped, alerts, orientations, [], flags, rules, trace, iv=iv)
    if stopped:
        return _result(artifact, stopped, alerts, orientations, [], flags, rules, trace, iv=iv)
    if s("S3") == YES:
        alerts.append("ATENCION_MISMO_DIA")
        orient("ATENCION_MISMO_DIA", "T_SEGURIDAD", "R01", "S3 = Sí (D-04: cuenta como confirmado)")
    if s("S2") == YES:
        alerts.append("EVALUACION_PRIORITARIA")
        orient(
            "EVALUACION_PRIORITARIA",
            "T_SOMNOLENCIA",
            "R01",
            "S2 = Sí: conducción o tarea de riesgo",
        )
    if v("D1") == YES:
        alerts.append("EVALUACION_PRIORITARIA")
        orient(
            "EVALUACION_PRIORITARIA", "T_SOMNOLENCIA", "R01", "somnolencia marcada: D1 = Sí (D-13)"
        )
    n2 = v("N2") or []
    if isinstance(n2, list) and ({"lesiones", "violencia"} & set(n2)):
        alerts.append("EVALUACION_PRIORITARIA")
        orient("EVALUACION_PRIORITARIA", "T_NOCTURNO", "R01", "episodios lesivos: N2 (D-13, D-26)")

    # --- R05: breathing suspicion (p. 13; D-12, D-14, D-17) ---
    q15 = v("Q15")
    q15_list = q15 if isinstance(q15, list) else []
    snoring = "ronca_fuerte" in q15_list or v("R2a") == YES
    sleepy = v("Q11") in ("dormido_sin_querer", "ambas") or v("R2b") == YES or v("D1") == YES
    breathing = v("R1") == YES or (snoring and (sleepy or v("R2c") == YES))
    unknown_snoring = v("R3") == YES
    if breathing:
        rules.append("R05")
        trace.append("R05: sospecha respiratoria")
    r4 = v("R4")
    complexity = iv.branch_open("R") and (r4 is None or (isinstance(r4, list) and len(r4) > 0))

    # --- R04: persistent insomnia (p. 13; D-09, D-15) ---
    chronic_core = chronic_from_core(iv)
    i3 = v("I3")
    chronic = i3 == YES or chronic_core is True
    if i3 is not None and chronic_core is not None and (i3 == YES) != chronic_core:
        trace.append("D-15: I3 y Q05/Q03 no coinciden → cuenta como crónico")
    better_explanation = v("I1") == NO or v("H4") == YES
    insomnia = (
        iv.branch_open("I")
        and v("I1") == YES
        and v("I2") == YES
        and chronic
        and not better_explanation
    )
    recent_high_impact = (
        iv.branch_open("I")
        and v("I1") == YES
        and v("I2") == YES
        and (i3 == NO or chronic_core is False)
        and not chronic
    )

    # --- R07: adapt therapy (p. 13; D-21) ---
    adapt = [
        name
        for name, present in (
            ("bipolaridad", iv.extracted("bipolaridad")),
            ("epilepsia", iv.extracted("epilepsia")),
            ("somnolencia marcada", v("D1") == YES),
            ("riesgo laboral", v("H3b") == YES or s("S2") == YES),
            ("síntomas mentales agudos", s("S3") == YES or s("S4") == YES),
        )
        if present
    ]

    # --- orientations: consultation / study ---
    prueba: str | None = None
    if insomnia and breathing:
        orient(
            "CONSULTA_ESTUDIO", "T_COMBINADO", "R08", "insomnio persistente + sospecha respiratoria"
        )
    elif breathing and not complexity and v("R6") != YES:
        orient(
            "CONSULTA_ESTUDIO",
            "T_RESPIRACION",
            "R05",
            "sospecha respiratoria sin complejidad (D-17)",
        )
    if (breathing or unknown_snoring) and complexity:
        orient("CONSULTA_ESTUDIO", "T_PSG", "R05", "R4 con complejidad o sin dato (D-17)")
        prueba = "polisomnografía en laboratorio"
    if breathing and v("R6") == YES:
        orient(
            "CONSULTA_ESTUDIO",
            "T_PSG",
            "R05",
            "R6: estudio domiciliario previo negativo, dudoso o no válido",
        )
        prueba = "polisomnografía"
    if unknown_snoring and not breathing and not complexity:
        orient(
            "CONSULTA_ESTUDIO", "T_RESPIRACION", "R05", "R3: «No lo sé» no descarta apnea (D-24)"
        )
    if v("D2a") == YES or v("D2b") == YES:
        orient("CONSULTA_ESTUDIO", "T_PSG", "R08", "D2: valoración por especialista")
        prueba = prueba or "polisomnografía y prueba de siestas"
    if v("P1") == YES and v("P2") == YES:
        orient("CONSULTA_ESTUDIO", "T_PIERNAS", "R08", "P1 y P2 = Sí")
    if v("N1") == YES and not any(o.template == "T_NOCTURNO" for o in orientations):
        orient("CONSULTA_ESTUDIO", "T_NOCTURNO", "R08", "N1 = Sí: episodios a revisar (p. 8)")
    if isinstance(n2, list) and n2:
        prueba = prueba or "video-polisomnografía según el caso"
    if v("H5") == YES:
        orient("CONSULTA_ESTUDIO", "T_HORARIO", "R08", "H5 = Sí: el patrón persiste o afecta mucho")
    if recent_high_impact:
        # v0.2 has no template for it (p. 5): the text is a draft (T_RECIENTE).
        orient("CONSULTA_ESTUDIO", "T_RECIENTE", "R06", "cuadro reciente con mucho impacto (D-19)")

    # --- therapy ---
    if insomnia and not breathing:
        orient("TERAPIA", "T_INSOMNIO", "R04", "R04 completo (D-15)")
    if insomnia and adapt:
        flags.append("ADAPTAR_TERAPIA")
        trace.append(f"R07: ADAPTAR_TERAPIA ({', '.join(adapt)}); sin restricción automática")

    # --- schedule and habits ---
    if v("H3a") == YES or v("H3b") == YES:
        orient("HABITOS", "T_HORARIO", "R08", "H3 = Sí: horario impuesto o turnos")
    opportunity = v("I1") == NO or v("H4") == YES
    if opportunity:
        orient("HABITOS", "T_HABITOS", "R06", "oportunidad insuficiente (I1 = No o H4 = Sí)")

    # --- R02 at close: safety unknown (D-08) and missing data ---
    for question in SAFETY:
        if s(question) is None:
            pending.append(question)
    for step_id in ("Q03", "Q05"):
        if v(step_id) is None and iv.branch_open("I") and v("I3") is None:
            pending.append(step_id)
    if pending:
        orient("INFORMACION_INSUFICIENTE", "T_INCOMPLETO", "R02", "falta: " + ", ".join(pending))

    return _result(artifact, None, alerts, orientations, pending, flags, rules, trace, prueba, iv)


def _result(
    artifact: FunnelArtifact,
    stopped: str | None,
    alerts: list[str],
    orientations: list[Orientation],
    pending: list[str],
    flags: list[str],
    rules: list[str],
    trace: list[str],
    prueba: str | None = None,
    iv: Interview | None = None,
) -> FunnelResult:
    assert iv is not None
    order: list[str] = artifact.engine["priority_order"]["order"]
    categories = sorted({o.category for o in orientations}, key=order.index)
    main = categories[0] if categories else None
    # One text per template, at its highest category (R08). Habits are never the
    # main action when a higher one exists (D-22): the order guarantees it.
    deduped: list[Orientation] = []
    seen: set[str | None] = set()
    for o in sorted(orientations, key=lambda x: order.index(x.category)):
        if o.template in seen:
            continue
        seen.add(o.template)
        deduped.append(o)
    from morpheo.funnel.catalogue import funnel_catalogue
    from morpheo.funnel.render import render  # local: render imports this module's types
    from morpheo.funnel.verify import verify

    texts, phrase_ids = render(artifact, deduped, iv, pending)
    # p. 14: the text adds no fact or advice beyond the engine's result.
    problems = verify(artifact, funnel_catalogue(), texts, (o.template for o in deduped))
    if problems:
        raise FunnelArtifactError("final text beyond the engine: " + "; ".join(problems))
    return FunnelResult(
        stopped_by=stopped,
        alerts=tuple(dict.fromkeys(alerts)),
        orientations=tuple(deduped),
        accion_principal=main,
        acciones_asociadas=tuple(categories[1:]),
        prueba_a_valorar=prueba,
        rule_ids=tuple(dict.fromkeys(rules)),
        datos_pendientes=tuple(pending),
        flags=tuple(flags),
        texts=tuple(texts),
        version_reglas=artifact.rules_version,
        trace=tuple(trace),
        phrase_ids=tuple(phrase_ids),
    )


__all__ = ["FunnelResult", "Orientation", "evaluate"]
