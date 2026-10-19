"""The vignettes in narrative mode, side by side with their full run.

    uv run python -m morpheo.ai.narrative            # text report
    uv run python -m morpheo.ai.narrative --json

Each vignette is played twice through the same engine: once answering every
question (the full run), once as the app does with the AI on -- after each
free text the recorded model output proposes answers, the confirmation screen
is answered by a careful person (keeps what the text really says, per the gold
labels; removes anything else; or follows the vignette's own
`narrative_decisions`), and the questions already answered are skipped.

The report says which questions were skipped, what was extracted (with the
person's words and their decision), which safety questions the AI added, and
whether the final result is identical to the full run. It must be.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any

from morpheo.ai.pipeline import AiExtractor
from morpheo.ai.provider import FixtureProvider, Provider
from morpheo.ai.quality import gold_items
from morpheo.ai.record import RECORDINGS_FILE, load_gold
from morpheo.funnel.artifact import FunnelArtifact, funnel_artifact
from morpheo.funnel.extraction import CONFIRMED, REMOVED, Record, is_ai_key
from morpheo.funnel.interview import Answer
from morpheo.funnel.vignettes import (
    VignetteRun,
    load_vignettes,
    result_signature,
    run_vignette,
)
from morpheo.instruments.definitions import InstrumentRegistry, load_registry
from morpheo.settings.config import Settings


@dataclass(frozen=True)
class ExtractedItem:
    source: str
    id: str
    value: Any
    evidence: str
    decision: str


@dataclass(frozen=True)
class NarrativeComparison:
    id: str
    title: str
    full_steps: int
    narrative_steps: int
    skipped: tuple[str, ...]
    extracted: tuple[ExtractedItem, ...]
    ai_safety: tuple[str, ...]
    failed_calls: tuple[str, ...]
    identical: bool
    differences: tuple[str, ...]


def _asked(run: VignetteRun) -> list[str]:
    return [a.key for a in run.asked if not is_ai_key(a.key)]


def compare(
    vignette: dict[str, Any],
    provider: Provider,
    gold: list[dict[str, Any]],
    artifact: FunnelArtifact | None = None,
    instruments: InstrumentRegistry | None = None,
) -> NarrativeComparison:
    artifact = artifact or funnel_artifact()
    full = run_vignette(vignette, artifact, instruments)
    case = copy.deepcopy(vignette)
    decisions: dict[str, Any] = case.setdefault("narrative_decisions", {})
    fixed = set(decisions)
    gold_by_text = {e["text"]: gold_items(artifact, e) for e in gold}
    extractor = AiExtractor(provider)
    chosen: dict[tuple[str, str], str] = {}

    def extract(
        a: FunnelArtifact, answers: Mapping[str, Answer], key: str, text: str
    ) -> Record | None:
        call = extractor.process(a, answers, key, text)
        if call is None:
            return None
        truth = gold_by_text.get(text, {})
        for item in call.record.items:
            if item.id not in fixed:
                decisions[item.id] = CONFIRMED if truth.get(item.id) == item.value else REMOVED
            spec = decisions[item.id]
            chosen[(key, item.id)] = spec["decision"] if isinstance(spec, dict) else spec
        return call.record

    narrative = run_vignette(case, artifact, instruments, extract=extract)
    full_sig, narrative_sig = result_signature(full.result), result_signature(narrative.result)
    differences = tuple(
        f"{name}: {full_sig[name]!r} ≠ {narrative_sig[name]!r}"
        for name in full_sig
        if full_sig[name] != narrative_sig[name]
    )
    narrative_keys = set(_asked(narrative))
    extracted = tuple(
        ExtractedItem(r.source, i.id, i.value, i.evidence, chosen.get((r.source, i.id), "?"))
        for r in narrative.records
        for i in r.items
    )
    return NarrativeComparison(
        id=vignette["id"],
        title=vignette["title"],
        full_steps=len(_asked(full)),
        narrative_steps=len(_asked(narrative)),
        skipped=tuple(k for k in _asked(full) if k not in narrative_keys),
        extracted=extracted,
        ai_safety=tuple(
            a.key for a in narrative.asked if a.reason is not None and a.reason.startswith("IA")
        ),
        failed_calls=tuple(r.source for r in narrative.records if r.status != "ok"),
        identical=not differences,
        differences=differences,
    )


def recorded_provider() -> tuple[FixtureProvider, str]:
    data = json.loads(RECORDINGS_FILE.read_text(encoding="utf-8"))
    return FixtureProvider(data["recordings"], data.get("model", "fixture")), data["source"]


def format_comparison(c: NarrativeComparison) -> str:
    verdict = "IDÉNTICO" if c.identical else "DISTINTO: " + "; ".join(c.differences)
    lines = [
        f"=== {c.id} · {c.title} ===",
        f"Pasos: {c.full_steps} completo → {c.narrative_steps} con relato · resultado {verdict}",
        f"Se omiten: {', '.join(c.skipped) or '—'}",
    ]
    for item in c.extracted:
        lines.append(
            f"  {item.source} → {item.id} = {item.value!r} «{item.evidence}» · {item.decision}"
        )
    if c.ai_safety:
        lines.append(f"Seguridad añadida por la IA: {', '.join(c.ai_safety)}")
    if c.failed_calls:
        lines.append(f"Llamadas fallidas: {', '.join(c.failed_calls)}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Vignettes in narrative mode vs full run.")
    parser.add_argument("--case", help="only this vignette id")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    provider, source = recorded_provider()
    registry = load_registry(Settings())
    gold = load_gold()
    comparisons = [
        compare(v, provider, gold, instruments=registry)
        for v in load_vignettes()
        if args.case in (None, v["id"])
    ]
    if args.json:
        print(json.dumps([asdict(c) for c in comparisons], ensure_ascii=False, indent=2))
    else:
        print(f"Salidas del modelo: {source}\n")
        print("\n\n".join(format_comparison(c) for c in comparisons))
        same = sum(c.identical for c in comparisons)
        total = len(comparisons)
        print(f"\n{same}/{total} viñetas con el mismo resultado que la entrevista completa.")
    return 0 if all(c.identical for c in comparisons) else 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
