"""Vignette runner: a scripted case through the v2.0 engine, end to end.

A vignette is a simulated patient: their narrative and their answers. The
runner plays the interview exactly as the app would -- asking `next_step`,
answering from the script -- and returns the full path: every question asked
and why, the branches opened, the rules fired, the category, the templates and
the final text.

Each answer says where it came from (`AskedStep.source`): "case" for what
defines the case (`answers`), "assumed" for the realistic answers the case
adds to reach the end (`assumed`), "default" when neither gives one and a
fixed default is used, and "shown" for texts the person only reads. Anything
not from the case is marked as supposed in the output, so nothing is hidden.

Usage:
    uv run python -m morpheo.funnel.vignettes            # all, text
    uv run python -m morpheo.funnel.vignettes --case V-09
    uv run python -m morpheo.funnel.vignettes --json
    uv run python -m morpheo.funnel.vignettes --file my_cases.json

The same `run_vignette` serves the admin console later (behind the v2.0 flag).
Free text is not sent to any model here: what the AI would extract is written in
the vignette (`extracted`) and treated as confirmed in Z1, so a run is fully
deterministic.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact, StepDef, funnel_artifact
from morpheo.funnel.display import answer_label
from morpheo.funnel.interview import NO_LO_SE, PREFIERO, Answer, Interview, Step, next_step
from morpheo.funnel.render import question_text
from morpheo.funnel.rules import FunnelResult, evaluate
from morpheo.instruments.definitions import InstrumentRegistry, load_registry
from morpheo.settings.config import Settings

VIGNETTES_FILE = (
    Path(__file__).resolve().parents[3] / "clinical" / "vignettes" / "vignettes_v2_borrador.json"
)
MAX_STEPS = 200


@dataclass(frozen=True)
class AskedStep:
    n: int
    key: str
    kind: str
    question: str
    answer: str
    source: str  # "case" | "assumed" | "default" | "shown"
    reason: str | None

    @property
    def assumed(self) -> bool:
        """Not given by the case: an assumed answer or a fixed default."""
        return self.source in ("assumed", "default")


@dataclass(frozen=True)
class VignetteRun:
    id: str
    title: str
    status: str
    asked: tuple[AskedStep, ...]
    branches_opened: tuple[str, ...]
    result: FunnelResult
    phrase_ids: tuple[str, ...]
    expected: dict[str, Any]
    failures: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not self.failures


def _default(definition: StepDef, kind: str) -> Answer:
    if kind == "info":
        return Answer(value="visto")
    if kind == "confirm":
        return Answer(value="sigue_igual")
    if definition.id == "Z1":
        return Answer(value="si")
    if definition.type in ("yes_no", "yes_no_note"):
        return Answer(value="no")
    if definition.type == "multi":
        return Answer(value=[])
    if definition.type == "single":
        return Answer(value="ninguna")
    if definition.type == "free_text":
        return Answer(absence=PREFIERO)
    return Answer(absence=NO_LO_SE)


def _from_script(spec: Any, definition: StepDef) -> Answer:
    if isinstance(spec, dict):
        if "absence" in spec:
            return Answer(absence=spec["absence"], text=spec.get("text"))
        if "text" in spec and "value" not in spec:
            value = spec["text"] if definition.type == "free_text" else None
            return Answer(value=value, text=spec["text"], extracted=spec.get("extracted", {}))
        if "value" in spec and "unit" in spec:
            return Answer(value={"value": spec["value"], "unit": spec["unit"]})
        if "value" in spec:
            return Answer(
                value=spec["value"], text=spec.get("text"), extracted=spec.get("extracted", {})
            )
    return Answer(value=spec)


def _lookup(script: dict[str, Any], key: str) -> Any:
    for candidate in (key, key.split(":")[0], key.split("@")[0]):
        if candidate in script:
            return script[candidate]
    return None


def _scripts(vignette: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """What defines the case (with the narrative as Q01), and what it assumes."""
    script = dict(vignette.get("answers", {}))
    if "narrative" in vignette:
        script.setdefault(
            "Q01",
            {"text": vignette["narrative"], "extracted": vignette.get("narrative_extracted", {})},
        )
    return script, dict(vignette.get("assumed", {}))


def scripted_answer(vignette: dict[str, Any], step: Step) -> tuple[Answer, str]:
    """The vignette's answer to a step, and where it came from (see `AskedStep`)."""
    script, assumed = _scripts(vignette)
    spec, source = _lookup(script, step.key), "case"
    if spec is None:
        spec, source = _lookup(assumed, step.key), "assumed"
    if step.kind == "info":
        source = "shown"
    elif spec is None:
        source = "default"
    answer = (
        _default(step.definition, step.kind)
        if spec is None
        else _from_script(spec, step.definition)
    )
    return answer, source


def answer_request(key: str, answer: Answer, definition: StepDef) -> dict[str, Any]:
    """The same answer as the v2 API takes it (FunnelAnswerRequest), for tests and E2E."""
    if answer.absence is not None:
        return {"key": key, "absence": answer.absence}
    if definition.type == "free_text":
        return {"key": key, "value": answer.text if answer.text is not None else answer.value}
    body: dict[str, Any] = {"key": key, "value": answer.value}
    if answer.text is not None and definition.type == "yes_no_note":
        body["text"] = answer.text
    return body


def _check(run_result: FunnelResult, expected: dict[str, Any], asked: list[AskedStep]) -> list[str]:
    failures: list[str] = []
    templates = {t for t, _ in run_result.texts}
    if (
        "accion_principal" in expected
        and run_result.accion_principal != expected["accion_principal"]
    ):
        got, want = run_result.accion_principal, expected["accion_principal"]
        failures.append(f"acción principal {got}, se esperaba {want}")
    for t in expected.get("templates_include", []):
        if t not in templates:
            failures.append(f"falta la plantilla {t}")
    for t in expected.get("templates_exclude", []):
        if t in templates:
            failures.append(f"no debía salir la plantilla {t}")
    if "stopped_by" in expected and run_result.stopped_by != expected["stopped_by"]:
        failures.append(f"parada por {run_result.stopped_by}, se esperaba {expected['stopped_by']}")
    for flag in expected.get("flags_include", []):
        if flag not in run_result.flags:
            failures.append(f"falta el indicador {flag}")
    for item in expected.get("pending_include", []):
        if item not in run_result.datos_pendientes:
            failures.append(f"falta el dato pendiente {item}")
    if "max_questions" in expected and len(asked) > expected["max_questions"]:
        failures.append(f"{len(asked)} pasos, se esperaban como máximo {expected['max_questions']}")
    for key in expected.get("asked_include", []):
        if not any(a.key.startswith(key) for a in asked):
            failures.append(f"no se preguntó {key}")
    for key in expected.get("asked_exclude", []):
        if any(a.key.startswith(key) for a in asked):
            failures.append(f"se preguntó {key} y no debía")
    return failures


def run_vignette(
    vignette: dict[str, Any],
    artifact: FunnelArtifact | None = None,
    instruments: InstrumentRegistry | None = None,
) -> VignetteRun:
    artifact = artifact or funnel_artifact()
    script, _ = _scripts(vignette)
    answers: dict[str, Answer] = {}
    asked: list[AskedStep] = []
    phrase_ids: list[str] = []
    for n in range(1, MAX_STEPS + 1):
        step = next_step(artifact, answers, instruments)
        if step is None:
            break
        answer, source = scripted_answer(vignette, step)
        if step.key == "PROT":
            question = artifact.protection_text
        else:
            # Z1 shows the summary built from the answers given so far.
            question, used = question_text(step.definition, Interview(artifact, answers))
            phrase_ids.extend(used)
        answers[step.key] = answer
        shown = answer_label(answer, step.definition, step.kind)
        asked.append(AskedStep(n, step.key, step.kind, question, shown, source, step.reason))
    else:
        raise RuntimeError(f"{vignette['id']}: more than {MAX_STEPS} steps")
    if "T_HABITOS.cambio" in script:
        answers["T_HABITOS.cambio"] = Answer(value=script["T_HABITOS.cambio"])
    result = evaluate(artifact, answers, instruments)
    iv = Interview(artifact, answers)
    branches = tuple(
        b for b in artifact.engine["branch_order"] if not result.stopped_by and iv.branch_open(b)
    )
    expected = vignette.get("expected", {})
    return VignetteRun(
        id=vignette["id"],
        title=vignette["title"],
        status=vignette.get("status", ""),
        asked=tuple(asked),
        branches_opened=branches,
        result=result,
        phrase_ids=tuple(dict.fromkeys([*phrase_ids, *result.phrase_ids])),
        expected=expected,
        failures=tuple(_check(result, expected, asked)),
    )


def load_vignettes(path: Path = VIGNETTES_FILE) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    vignettes: list[dict[str, Any]] = data["vignettes"]
    return vignettes


def format_run(run: VignetteRun) -> str:
    r = run.result
    lines = [f"=== {run.id} · {run.title} ({run.status}) ==="]
    lines.append(f"Pasos ({len(run.asked)}):")
    for a in run.asked:
        mark = {"assumed": " (supuesta)", "default": " (supuesta, por defecto)"}.get(a.source, "")
        if a.kind == "confirm":
            mark += " (confirmación)"
        why = f"   ← {a.reason}" if a.reason else ""
        lines.append(f"  {a.n:>2}. {a.key:<22} {a.question[:90]} → {a.answer}{mark}{why}")
    lines.append(f"Ramas abiertas: {', '.join(run.branches_opened) or '—'}")
    lines.append(f"Parada: {r.stopped_by or '—'}")
    lines.append(f"Reglas: {', '.join(r.rule_ids) or '—'}")
    for t in r.trace:
        lines.append(f"  · {t}")
    lines.append(f"Alertas: {', '.join(r.alerts) or '—'}")
    associated = ", ".join(r.acciones_asociadas) or "—"
    lines.append(f"Acción principal: {r.accion_principal or '—'} · Asociadas: {associated}")
    lines.append(f"Prueba a valorar: {r.prueba_a_valorar or '—'}")
    pending = ", ".join(r.datos_pendientes) or "—"
    lines.append(f"Indicadores: {', '.join(r.flags) or '—'} · Datos pendientes: {pending}")
    lines.append(f"Plantillas: {', '.join(t for t, _ in r.texts) or '—'}")
    lines.append(f"Frases del catálogo: {', '.join(run.phrase_ids) or '—'}")
    lines.append("Texto final:")
    for template, text in r.texts:
        lines.append(f"  [{template}] {text}")
    verdict = "OK" if run.passed else "FALLA: " + "; ".join(run.failures)
    lines.append(f"Esperado: {verdict}")
    return "\n".join(lines)


E2E_VIGNETTES = ("FT-1", "V-10")
E2E_FIXTURE = (
    Path(__file__).resolve().parents[5]
    / "apps"
    / "somnus-app"
    / "tests"
    / "e2e"
    / "fixtures"
    / "funnel-v2-vignettes.json"
)


def e2e_plan(
    vignette: dict[str, Any],
    artifact: FunnelArtifact | None = None,
    instruments: InstrumentRegistry | None = None,
) -> dict[str, Any]:
    """What the E2E test does on each screen of the real UI, and the final text
    it must end with -- the same answers and the same text as the runner."""
    artifact = artifact or funnel_artifact()
    answers: dict[str, Answer] = {}
    steps: list[dict[str, Any]] = []
    for _ in range(MAX_STEPS):
        step = next_step(artifact, answers, instruments)
        if step is None:
            break
        answer, _ = scripted_answer(vignette, step)
        body = answer_request(step.key, answer, step.definition)
        d = step.definition
        labels = {o.key: o.label for o in (*d.options, *d.fields)}
        ui: dict[str, Any] = {"key": step.key, "kind": step.kind, "type": d.type}
        ui |= {k: v for k, v in body.items() if k != "key"}
        if d.type == "multi" and isinstance(answer.value, list):
            ui["labels"] = [labels[k] for k in answer.value]
        if d.type == "single" and isinstance(answer.value, str):
            ui["labels"] = [labels.get(answer.value, "")]
        if d.type == "times" and isinstance(answer.value, dict):
            ui["fields"] = {labels[k]: v for k, v in answer.value.items()}
        steps.append(ui)
        answers[step.key] = answer
    result = evaluate(artifact, answers, instruments)
    return {"id": vignette["id"], "steps": steps, "finalText": [x for _, x in result.texts]}


def e2e_fixture() -> str:
    registry = load_registry(Settings())
    plans = [
        e2e_plan(v, instruments=registry) for v in load_vignettes() if v["id"] in E2E_VIGNETTES
    ]
    note = (
        "Generated by `python -m morpheo.funnel.vignettes --e2e-fixture`; "
        "then laid out by Biome; tests/unit/funnel/test_e2e_fixture.py fails if it "
        "falls out of step with the engine."
    )
    return json.dumps({"note": note, "vignettes": plans}, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Morpheo v2.0 vignettes.")
    parser.add_argument("--case", help="only this vignette id")
    parser.add_argument("--file", type=Path, default=VIGNETTES_FILE)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--e2e-fixture", action="store_true", help="rewrite the E2E fixture")
    args = parser.parse_args(argv)
    if args.e2e_fixture:
        E2E_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        E2E_FIXTURE.write_text(e2e_fixture(), encoding="utf-8", newline="\n")
        print(f"wrote {E2E_FIXTURE}")
        return 0
    vignettes = [v for v in load_vignettes(args.file) if args.case in (None, v["id"])]
    # The instruments as the service loads them (pending until their files arrive).
    registry = load_registry(Settings())
    runs = [run_vignette(v, instruments=registry) for v in vignettes]
    if args.json:
        print(
            json.dumps(
                [asdict(r) | {"passed": r.passed} for r in runs], ensure_ascii=False, indent=2
            )
        )
    else:
        print("\n\n".join(format_run(r) for r in runs))
        print(f"\n{sum(r.passed for r in runs)}/{len(runs)} viñetas como se esperaba.")
    return 0 if all(r.passed for r in runs) else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
