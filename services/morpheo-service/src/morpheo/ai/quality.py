"""Extraction quality: the recorded outputs against the gold labels, per field.

    uv run python -m morpheo.ai.quality

For each field (Q03, Q08, R2c, Q14.bipolaridad…): precision (of what the model
proposed, how much is right) and recall (of what the text states, how much it
proposed), counting a proposal right only when its value is the gold value.
Proposals are read exactly as the app reads them -- validated against the
schema and the person's words, markers restored -- so what is counted is what
the person would see on the confirmation screen. Every wrong proposal is listed
with the screen that would show it: nothing reaches a rule unconfirmed.

The safety screen is scored apart: of the texts that point at S1/S4/S2, how
many the classifier flagged ("si" or "dudoso" -- both ask the question now).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from morpheo.ai.pipeline import run
from morpheo.ai.provider import FixtureProvider
from morpheo.ai.record import GOLD_FILE, RECORDINGS_FILE, load_gold
from morpheo.funnel.artifact import FunnelArtifact, funnel_artifact
from morpheo.funnel.extraction import RISK_QUESTIONS, SCREEN_ONLY, all_targets, validate


@dataclass
class FieldScore:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float | None:
        proposed = self.tp + self.fp
        return None if proposed == 0 else self.tp / proposed

    @property
    def recall(self) -> float | None:
        stated = self.tp + self.fn
        return None if stated == 0 else self.tp / stated


@dataclass
class Quality:
    source: str
    fields: dict[str, FieldScore] = field(default_factory=lambda: defaultdict(FieldScore))
    wrong: list[dict[str, Any]] = field(default_factory=list)
    missed: list[dict[str, Any]] = field(default_factory=list)
    failed_calls: list[str] = field(default_factory=list)
    risk_flagged: int = 0
    risk_stated: int = 0
    risk_missed: list[str] = field(default_factory=list)

    def total(self) -> FieldScore:
        out = FieldScore()
        for score in self.fields.values():
            out.tp += score.tp
            out.fp += score.fp
            out.fn += score.fn
        return out


def gold_items(artifact: FunnelArtifact, entry: dict[str, Any]) -> dict[str, Any]:
    """The gold labels as engine values (the same reading as a model output)."""
    output = json.dumps({"items": entry["items"], "risk": entry["risk"]}, ensure_ascii=False)
    checked = validate(artifact, output, entry["text"], all_targets(artifact))
    assert checked is not None and checked[2] == 0, f"bad gold: {entry['set']} {entry['source']}"
    return {item.id: item.value for item in checked[0]}


def score(
    artifact: FunnelArtifact, gold: list[dict[str, Any]], provider: FixtureProvider, source: str
) -> Quality:
    quality = Quality(source=source)
    for entry in gold:
        where = f"{entry['set']} {entry['source']}"
        call = run(
            artifact,
            {},
            source_key=entry["source"],
            text=entry["text"],
            provider=provider,
            extract=entry["source"] not in SCREEN_ONLY,
        )
        record = call.record
        if record.status != "ok":
            quality.failed_calls.append(f"{where}: {call.event.status}")
        expected = gold_items(artifact, entry)
        proposed = {item.id: item for item in record.items}
        for item_id, item in proposed.items():
            if expected.get(item_id) == item.value:
                quality.fields[item_id].tp += 1
            else:
                quality.fields[item_id].fp += 1
                quality.wrong.append(
                    {
                        "where": where,
                        "id": item_id,
                        "proposed": item.value,
                        "gold": expected.get(item_id),
                        "evidence": item.evidence,
                        # Shown on the confirmation screen of this answer.
                        "confirmation": f"{entry['source']}#confirmacion",
                    }
                )
        for item_id, value in expected.items():
            if item_id not in proposed or proposed[item_id].value != value:
                quality.fields[item_id].fn += 1
                if item_id not in proposed:
                    quality.missed.append({"where": where, "id": item_id, "gold": value})
        for question in RISK_QUESTIONS:
            if entry["risk"][question] in ("si", "dudoso"):
                quality.risk_stated += 1
                if record.risk.get(question) in ("si", "dudoso") or record.status != "ok":
                    quality.risk_flagged += 1
                else:
                    quality.risk_missed.append(f"{where}: {question}")
    return quality


def _pct(value: float | None) -> str:
    return "—" if value is None else f"{100 * value:.0f} %"


def format_quality(quality: Quality) -> str:
    lines = [f"Calidad de la extracción · salidas: {quality.source}"]
    if quality.source == "stand-in":
        lines.append(
            "  AVISO: salidas de relleno (las etiquetas gold). Las cifras no miden el modelo "
            "hasta grabar con `python -m morpheo.ai.record`."
        )
    lines.append(f"  {'campo':<20} {'precisión':>10} {'exhaustividad':>14}   VP  FP  FN")
    for item_id in sorted(quality.fields):
        s = quality.fields[item_id]
        lines.append(
            f"  {item_id:<20} {_pct(s.precision):>10} {_pct(s.recall):>14}"
            f"  {s.tp:>3} {s.fp:>3} {s.fn:>3}"
        )
    t = quality.total()
    counts = f"{t.tp:>3} {t.fp:>3} {t.fn:>3}"
    lines.append(f"  {'TOTAL':<20} {_pct(t.precision):>10} {_pct(t.recall):>14}  {counts}")
    lines.append(
        f"Seguridad: {quality.risk_flagged}/{quality.risk_stated} textos con riesgo marcados "
        "(«si» o «dudoso»; una llamada fallida también pregunta)"
    )
    for missed in quality.risk_missed:
        lines.append(f"  NO marcado: {missed}")
    lines.append(f"Propuestas erróneas: {len(quality.wrong)} (todas pasan por la confirmación)")
    for wrong in quality.wrong:
        lines.append(
            f"  {wrong['where']} {wrong['id']}: {wrong['proposed']!r} (gold {wrong['gold']!r}) "
            f"→ se muestra en {wrong['confirmation']}"
        )
    for failed in quality.failed_calls:
        lines.append(f"  llamada fallida: {failed}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extraction quality against the gold labels.")
    parser.add_argument("--gold", type=Path, default=GOLD_FILE)
    parser.add_argument("--recordings", type=Path, default=RECORDINGS_FILE)
    args = parser.parse_args(argv)
    data = json.loads(args.recordings.read_text(encoding="utf-8"))
    provider = FixtureProvider(data["recordings"], data.get("model", "fixture"))
    quality = score(funnel_artifact(), load_gold(args.gold), provider, data.get("source", "?"))
    print(format_quality(quality))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
