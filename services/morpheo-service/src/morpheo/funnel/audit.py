"""Coherence audit: thousands of interviews with varied answers, not a handful of cases.

    uv run python -m morpheo.funnel.audit                 # 2,000 interviews, text report
    uv run python -m morpheo.funnel.audit --walks 5000 --markdown informe.md

The vignettes prove the paths someone wrote down. This plays interviews the way
the app asks them, answered by six kinds of person (calm, troubled, undecided,
random, one with insomnia, and one whose narrative the AI turned into answers),
and looks at every result for two things:

* incoherences -- two answers that do not fit together (5 hours of sleep and
  "enough time to sleep"; daytime tiredness and "no impact on the day");
* ignored signals -- something worth looking at that ended in no orientation.

It runs the engine twice per interview, with and without the coherence checks
(`morpheo.funnel.coherence`), so the report shows what the checks change. It
never calls a model and reads no person's data: every answer is generated here.
"""

from __future__ import annotations

import argparse
import random
import sys
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact, funnel_artifact
from morpheo.funnel.extraction import ORIGIN_AI
from morpheo.funnel.interview import (
    NO,
    NO_LO_SE,
    PREFIERO,
    SAFETY,
    YES,
    Answer,
    Interview,
    Step,
    next_step,
)
from morpheo.funnel.rules import evaluate

MAX_STEPS = 200
UNITS = ["dias", "semanas", "meses", "años"]
# A "Sí" to a safety question ends most interviews, and it is rare in real life: at
# the persona's rate almost no interview would reach the questions under audit.
SAFETY_YES = 0.02
# What the AI may fill from the narrative (v0.2 p. 14), simulated by the "narrative" persona.
AI_FILLABLE = {"Q03", "Q05", "Q07a", "Q07b", "Q07c", "Q07d", "Q08", "Q09", "Q11", "Q12", "Q13",
               "Q15", "Q16", "Q17", "Q18", "I1", "I2", "I3", "R2a", "R2b", "R2c", "R3", "H3a",
               "H3b", "H4"}  # fmt: skip


@dataclass(frozen=True)
class Persona:
    name: str
    yes: float  # how often a yes/no is "Sí", and each multi option is ticked
    unknown: float  # how often an answer is "No lo sé" / "Prefiero no responder"
    ai: float = 0.0  # how often an AI-fillable answer comes from the narrative
    yes_for: Mapping[str, float] = field(default_factory=dict)  # per question, over `yes`


PERSONAS = (
    Persona("tranquila", yes=0.05, unknown=0.01),
    Persona("con_problemas", yes=0.6, unknown=0.03),
    Persona("dudosa", yes=0.3, unknown=0.35),
    Persona("al_azar", yes=0.5, unknown=0.1),
    Persona("relato_ia", yes=0.3, unknown=0.05, ai=0.5),
    # The main path of the engine: without it almost nothing reaches I1-I3 "Sí".
    Persona(
        "insomnio",
        yes=0.1,
        unknown=0.03,
        yes_for={"Q08": 0.8, "Q11": 0.1, "Q13": 0.9, "I1": 0.9, "I2": 0.9, "I3": 0.8},
    ),
)


def _answer(seed: int, step: Step, p: Persona) -> Answer:
    d = step.definition
    # Fixed per person and question, so the same person gives the same answers with
    # and without the checks, whatever extra question those add.
    rng = random.Random(f"{seed}:{d.id}")
    yes = min(p.yes, SAFETY_YES) if d.id in SAFETY else p.yes_for.get(d.id, p.yes)
    if step.kind == "info":
        return Answer(value="visto")
    if step.kind == "confirm":
        return Answer(value="sigue_igual")
    if d.id == "Z1":
        return Answer(value=YES)
    if rng.random() < p.unknown:
        return Answer(absence=PREFIERO if d.type == "free_text" else NO_LO_SE)
    origin = ORIGIN_AI if d.id in AI_FILLABLE and rng.random() < p.ai else None
    value: Any
    if d.type in ("yes_no", "yes_no_note"):
        value = YES if rng.random() < yes else NO
    elif d.type == "multi":
        value = [o.key for o in d.options if rng.random() < yes]
    elif d.id == "Q11":
        # Two of its three options mean falling asleep unwillingly: not an even choice.
        value = rng.choice(["dormido_sin_querer", "ambas"]) if rng.random() < yes else "cansancio"
    elif d.type == "single":
        value = rng.choice([o.key for o in d.options])
    elif d.type == "number":
        value = rng.randint(18, 90) if d.id == "AGE" else rng.randint(0, 7)
    elif d.type == "duration":
        if d.id == "Q09":
            value = {"value": rng.randint(3, 10), "unit": "horas"}
        else:
            value = {"value": rng.randint(1, 24), "unit": rng.choice(UNITS)}
    elif d.type == "times":
        value = {f.key: f"{rng.randint(0, 23):02d}:{rng.choice(['00', '30'])}" for f in d.fields}
    elif d.type == "free_text":
        return Answer(value="texto libre", text="texto libre")
    else:
        return Answer(absence=NO_LO_SE)
    return Answer(value=value, origin=origin)


def interview(seed: int, artifact: FunnelArtifact) -> tuple[Persona, dict[str, Answer]]:
    """One interview from start to finish; the seed fixes the persona and every answer."""
    persona = PERSONAS[seed % len(PERSONAS)]
    answers: dict[str, Answer] = {}
    for _ in range(MAX_STEPS):
        step = next_step(artifact, answers)
        if step is None:
            return persona, answers
        answers[step.key] = _answer(seed, step, persona)
    raise RuntimeError(f"seed {seed}: the interview never ends")


def without_checks(artifact: FunnelArtifact) -> FunnelArtifact:
    raw = dict(artifact.raw)
    raw["engine"] = {k: v for k, v in artifact.engine.items() if k != "coherence"}
    return replace(artifact, raw=raw)


# --- what is looked for ---------------------------------------------------------------


def _hours(iv: Interview) -> float | None:
    q09 = iv.value("Q09")
    if isinstance(q09, dict) and q09.get("unit") == "horas":
        return float(q09["value"])
    return None


def _clock(value: Any, key: str) -> float | None:
    if not isinstance(value, dict) or not isinstance(value.get(key), str):
        return None
    hours, minutes = value[key].split(":")
    return int(hours) + int(minutes) / 60


def _window(iv: Interview) -> float | None:
    """Hours between trying to sleep (Q07b) and waking up (Q07c)."""
    start, end = (
        _clock(iv.value("Q07b"), "intentar_dormir"),
        _clock(iv.value("Q07c"), "despertarse"),
    )
    if start is None or end is None:
        return None
    return (end - start) % 24


def _days(iv: Interview, key: str) -> float | None:
    value = iv.value(key)
    per = {"dias": 1, "semanas": 7, "meses": 30.4, "años": 365}
    if isinstance(value, dict) and value.get("unit") in per:
        return float(value["value"]) * per[value["unit"]]
    return None


def _has(iv: Interview, key: str, option: str) -> bool:
    value = iv.value(key)
    return isinstance(value, list) and option in value


@dataclass(frozen=True)
class Finding:
    id: str
    describes: str
    test: Callable[[Interview], bool]
    handled_by: str = ""  # a check or DEFAULT that resolves it, if any
    proposal: str = ""  # what could be done; the clinical lead decides


INCOHERENCES = (
    Finding("K01", "Duerme 6 h o menos (Q09) y dice tener tiempo y lugar adecuados (Q13 = Sí)",
            lambda iv: (h := _hours(iv)) is not None and h <= 6 and iv.value("Q13") == YES,
            "C-01 pregunta H4 si nada más orienta"),
    Finding("K02", "Síntomas de día (Q11) o siestas (Q12 = Sí) y «no le afecta» (I2 = No)",
            lambda iv: iv.value("I2") == NO
            and (iv.value("Q11") is not None or iv.value("Q12") == YES),
            "C-02 solo si el «No» vino de la IA"),
    Finding("K03", "Se duerme sin querer (Q11) y luego «no» a dormirse sin querer (R2b = No)",
            lambda iv: iv.value("Q11") in ("dormido_sin_querer", "ambas")
            and iv.value("R2b") == NO,
            proposal="Dar por sabido «Sí» en R2b (como D1)"),
    Finding("K04", "Ronca fuerte (Q15) y luego «no ronca a menudo» (R2a = No)",
            lambda iv: _has(iv, "Q15", "ronca_fuerte") and iv.value("R2a") == NO,
            proposal="Dar por sabido «Sí» en R2a (como R1)"),
    Finding("K05", "Tiempo y lugar adecuados (Q13 = Sí) y le falta tiempo para dormir (H4 = Sí)",
            lambda iv: iv.value("Q13") == YES and iv.value("H4") == YES,
            proposal="Tomar H4 como válida; volver a preguntar Q13"),
    Finding("K06", "3+ noches/semana (Q05) desde 3+ meses (Q03) y «no» a I3",
            lambda iv: isinstance(iv.value("Q05"), int) and iv.value("Q05") >= 3
            and (d := _days(iv, "Q03")) is not None and d >= 90 and iv.value("I3") == NO,
            "D-15: cuenta como crónico"),
    Finding("K07", "Dice dormir más horas (Q09) que las que pasa en la cama (Q07b→Q07c)",
            lambda iv: (h := _hours(iv)) is not None and (w := _window(iv)) is not None
            and h > w + 1,
            proposal="Volver a preguntar Q09 con los horarios a la vista"),
    Finding("K08", "Le cuesta dormir aun con tiempo (I1 = Sí) y no tiene tiempo o lugar (Q13 = No)",
            lambda iv: iv.value("I1") == YES and iv.value("Q13") == NO,
            proposal="Aclarar qué parte falla: tiempo, lugar o ambos"),
    Finding("K09", "Ninguna dificultad nocturna (Q08 vacío) y duerme 5 h o menos (Q09)",
            lambda iv: iv.value("Q08") == [] and (h := _hours(iv)) is not None and h <= 5,
            proposal="Abrir H o preguntar H4 (como C-01)"),
)  # fmt: skip

SIGNALS = (
    Finding("S01", "Duerme 6 h o menos (Q09)", lambda iv: (h := _hours(iv)) is not None and h <= 6),
    Finding("S02", "Se duerme sin querer de día (Q11)",
            lambda iv: iv.value("Q11") in ("dormido_sin_querer", "ambas")),
    Finding("S03", "Siestas o cabezadas (Q12 = Sí)", lambda iv: iv.value("Q12") == YES),
    Finding("S04", "3 o más noches por semana (Q05)",
            lambda iv: isinstance(iv.value("Q05"), int) and iv.value("Q05") >= 3),
    Finding("S05", "Desde hace 3 meses o más (Q03)",
            lambda iv: (d := _days(iv, "Q03")) is not None and d >= 90),
    Finding("S06", "Alguna dificultad nocturna (Q08)",
            lambda iv: isinstance(iv.value("Q08"), list) and len(iv.value("Q08")) > 0),
    Finding("S07", "Molestia, enfermedad o tratamiento que influye (Q14a-c = Sí)",
            lambda iv: any(iv.value(k) == YES for k in ("Q14a", "Q14b", "Q14c"))),
    Finding("S08", "Medicinas, café, alcohol u otras sustancias (Q14d = Sí)",
            lambda iv: iv.value("Q14d") == YES),
    Finding("S09", "Cambio en su vida cuando empezó (Q04 = Sí)", lambda iv: iv.value("Q04") == YES),
)  # fmt: skip


# --- the run --------------------------------------------------------------------------


@dataclass
class Tally:
    walks: int = 0
    mains: Counter[str] = field(default_factory=Counter)
    incoherent: Counter[str] = field(default_factory=Counter)
    ignored: Counter[str] = field(default_factory=Counter)
    signalled: Counter[str] = field(default_factory=Counter)
    rechecked: Counter[str] = field(default_factory=Counter)
    examples: dict[str, int] = field(default_factory=dict)
    by_persona: dict[str, Counter[str]] = field(default_factory=dict)


def _score(tally: Tally, seed: int, persona: Persona, answers: Mapping[str, Answer],
           artifact: FunnelArtifact) -> None:  # fmt: skip
    iv = Interview(artifact, answers)
    result = evaluate(artifact, answers)
    main = result.accion_principal or ("PARADA" if result.stopped_by else "NINGUNA")
    tally.walks += 1
    tally.mains[main] += 1
    tally.by_persona.setdefault(persona.name, Counter())[main] += 1
    for key in answers:
        if key.endswith("@coherencia"):
            tally.rechecked[key] += 1
    if result.stopped_by:
        return
    for finding in INCOHERENCES:
        if finding.test(iv):
            tally.incoherent[finding.id] += 1
            tally.examples.setdefault(finding.id, seed)
    for finding in SIGNALS:
        if finding.test(iv):
            tally.signalled[finding.id] += 1
            if main in ("SIN_ORIENTACION", "NINGUNA"):
                tally.ignored[finding.id] += 1
                tally.examples.setdefault("ignored:" + finding.id, seed)


def run(walks: int, artifact: FunnelArtifact | None = None) -> tuple[Tally, Tally]:
    """(without the coherence checks, with them), over the same seeds."""
    with_checks = artifact or funnel_artifact()
    plain = without_checks(with_checks)
    before, after = Tally(), Tally()
    for seed in range(walks):
        for tally, art in ((before, plain), (after, with_checks)):
            persona, answers = interview(seed, art)
            _score(tally, seed, persona, answers, art)
    return before, after


def _pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.1f} %" if whole else "—"


def report(before: Tally, after: Tally) -> str:
    n = after.walks
    lines = [
        f"# Auditoría de coherencia del motor — {n} entrevistas simuladas",
        "",
        "Perfiles: " + ", ".join(p.name for p in PERSONAS) + " (en partes iguales). "
        "Sin datos de personas reales; ningún modelo llamado.",
        "",
        "**Cómo leer estas cifras.** Las respuestas son simuladas y casi todas se eligen sin "
        "relación con las demás. Los porcentajes dicen qué caminos existen en el motor, **no** "
        "con qué frecuencia ocurrirá en personas reales: un recuento alto no es un problema "
        "frecuente, y K07 mide horarios al azar. Un 0 sí significa que el diseño lo impide. "
        "«Sin» es el motor sin comprobaciones; «Con» añade C-01 y C-02. Una "
        "incoherencia sigue contando con las comprobaciones: la comprobación vuelve a preguntar, "
        "no borra la respuesta. Las propuestas son para que decida el responsable clínico.",
        "",
        "## Resultado final (sin comprobaciones → con comprobaciones)",
        "",
        "| Acción principal | Sin | Con |",
        "|---|---|---|",
    ]
    for main in sorted(set(before.mains) | set(after.mains)):
        lines.append(f"| {main} | {_pct(before.mains[main], n)} | {_pct(after.mains[main], n)} |")
    lines += ["", "## Incoherencias entre respuestas", "",
              "| Id | Qué no encaja | Sin | Con | Hoy lo resuelve | Propuesta | Semilla |",
              "|---|---|---|---|---|---|---|"]  # fmt: skip
    for f in INCOHERENCES:
        lines.append(
            f"| {f.id} | {f.describes} | {before.incoherent[f.id]} | {after.incoherent[f.id]} | "
            f"{f.handled_by or '**nada todavía**'} | {f.proposal or '—'} | "
            f"{before.examples.get(f.id, '—')} |"
        )
    lines += ["", "## Señales que acaban sin ninguna orientación", "",
              "Entre las entrevistas con la señal, cuántas terminan en SIN_ORIENTACION.", "",
              "| Id | Señal | Con la señal | Sin orientación (sin) | Sin orientación (con) |",
              "|---|---|---|---|---|"]  # fmt: skip
    for f in SIGNALS:
        lines.append(
            f"| {f.id} | {f.describes} | {after.signalled[f.id]} | "
            f"{_pct(before.ignored[f.id], before.signalled[f.id])} | "
            f"{_pct(after.ignored[f.id], after.signalled[f.id])} |"
        )
    lines += ["", "## Observaciones de diseño", "",
              "- Q11 no tiene opción «ninguna»: quien no tiene síntomas de día solo puede elegir "
              "«cansancio» o «No lo sé», y dos de sus tres opciones llevan a D1 = Sí y a "
              "EVALUACION_PRIORITARIA.",
              "- Q09 (horas de sueño) no interviene en ninguna regla de v0.2."]  # fmt: skip
    lines += ["", "## Preguntas repetidas por coherencia (con comprobaciones)", ""]
    for key, count in sorted(after.rechecked.items()):
        lines.append(f"- {key}: {count} ({_pct(count, n)})")
    if not after.rechecked:
        lines.append("- ninguna")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--walks", type=int, default=2000)
    parser.add_argument("--markdown", type=Path, help="write the report to this file")
    args = parser.parse_args(argv)
    text = report(*run(args.walks))
    if args.markdown:
        args.markdown.write_text(text, encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
