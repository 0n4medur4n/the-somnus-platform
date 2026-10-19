"""Records the model's outputs for the gold texts, so tests replay them offline.

    uv run python -m morpheo.ai.record              # calls OpenAI (needs OPENAI_API_KEY)
    uv run python -m morpheo.ai.record --stand-in   # no call: the gold labels as outputs

Only the synthetic texts of the gold file are sent -- never a person's answer
-- and each goes through the same pipeline as in the app: pseudonymised first,
`store=False`, the model and endpoint from config. The key is read from the
environment by the OpenAI provider and never printed or written.

The recordings file says where its outputs came from (`source`): "openai"
(with the model) or "stand-in", the gold labels written by hand. A stand-in
file makes the tests run, but its quality numbers mean nothing until the
outputs are real.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from morpheo.ai.pipeline import run
from morpheo.ai.prompts import PROMPT_VERSION
from morpheo.ai.provider import (
    ModelReply,
    ModelRequest,
    OpenAiProvider,
    Provider,
    recording_key,
    region_of,
)
from morpheo.ai.pseudonymise import Pseudonymised, pseudonymise
from morpheo.funnel.artifact import funnel_artifact
from morpheo.funnel.extraction import SCREEN_ONLY
from morpheo.settings.config import Settings

SERVICE_ROOT = Path(__file__).resolve().parents[3]
GOLD_FILE = SERVICE_ROOT / "tests" / "fixtures" / "ai" / "gold_v2.json"
RECORDINGS_FILE = SERVICE_ROOT / "tests" / "fixtures" / "ai" / "recordings_v2.json"


def load_gold(path: Path = GOLD_FILE) -> list[dict[str, Any]]:
    texts: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))["texts"]
    return texts


def _mask(pseudo: Pseudonymised, words: str) -> str:
    """The gold words as the model sees them: every identifier replaced by its marker."""
    for marker, original in pseudo.mapping:
        words = words.replace(original, marker)
    return words


def gold_output(entry: dict[str, Any], pseudo: Pseudonymised) -> dict[str, Any]:
    """The gold labels written as the model's answer to the pseudonymised text."""
    items = []
    for item in entry["items"]:
        value = item["value"]
        items.append(
            {
                "id": item["id"],
                "value": _mask(pseudo, value) if isinstance(value, str) else value,
                "evidence": _mask(pseudo, item["evidence"]),
            }
        )
    return {"items": items, "risk": entry["risk"]}


class GoldProvider:
    """Answers each gold text with its own labels (the stand-in recordings)."""

    def __init__(self, gold: list[dict[str, Any]]) -> None:
        self._by_text = {pseudonymise(e["text"]).text: e for e in gold}

    @property
    def model(self) -> str:
        return "stand-in"

    @property
    def region(self) -> str:
        return "none"

    def complete(self, request: ModelRequest) -> ModelReply:
        entry = self._by_text[request.text]
        output = gold_output(entry, pseudonymise(entry["text"]))
        return ModelReply(json.dumps(output, ensure_ascii=False), "stand-in")


class RecordingProvider:
    """Passes each call through and keeps its output, keyed for `FixtureProvider`."""

    def __init__(self, inner: Provider) -> None:
        self._inner = inner
        self.recordings: dict[str, dict[str, Any]] = {}
        self.current: dict[str, str] = {}

    @property
    def model(self) -> str:
        return self._inner.model

    @property
    def region(self) -> str:
        return self._inner.region

    def complete(self, request: ModelRequest) -> ModelReply:
        reply = self._inner.complete(request)
        self.recordings[recording_key(request.prompt_version, request.text)] = {
            **self.current,
            "model": reply.model,
            "output": json.loads(reply.text) if reply.text else reply.text,
        }
        return reply


def record(gold: list[dict[str, Any]], inner: Provider) -> tuple[dict[str, Any], list[str]]:
    artifact = funnel_artifact()
    recorder = RecordingProvider(inner)
    failures: list[str] = []
    for entry in gold:
        recorder.current = {"set": entry["set"], "source": entry["source"]}
        call = run(
            artifact,
            {},
            source_key=entry["source"],
            text=entry["text"],
            provider=recorder,
            extract=entry["source"] not in SCREEN_ONLY,
        )
        if call.event.status != "ok":
            failures.append(f"{entry['set']} {entry['source']}: {call.event.status}")
    return recorder.recordings, failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Record model outputs for the gold texts.")
    parser.add_argument("--stand-in", action="store_true", help="no model: gold labels as outputs")
    parser.add_argument("--gold", type=Path, default=GOLD_FILE)
    parser.add_argument("--out", type=Path, default=RECORDINGS_FILE)
    args = parser.parse_args(argv)
    gold = load_gold(args.gold)
    settings = Settings()
    if args.stand_in:
        provider: Provider = GoldProvider(gold)
        source, model = "stand-in", "stand-in"
    else:
        if not settings.openai_api_key:
            print("OPENAI_API_KEY is not set: nothing recorded.", file=sys.stderr)
            return 2
        provider = OpenAiProvider(
            api_key=settings.openai_api_key,
            model=settings.ai_model,
            base_url=settings.openai_base_url,
            timeout_seconds=max(settings.ai_timeout_seconds, 30.0),
            reasoning_effort=settings.ai_reasoning_effort,
            temperature=settings.ai_temperature,
        )
        source, model = "openai", settings.ai_model
        print(
            f"Recording {len(gold)} synthetic texts with {model} "
            f"({region_of(settings.openai_base_url)}), store=False…"
        )
    recordings, failures = record(gold, provider)
    note = (
        "STAND-IN: the gold labels written as model outputs, no model was called. "
        "Replace with `uv run python -m morpheo.ai.record` (OPENAI_API_KEY set)."
        if args.stand_in
        else "Real model outputs for the synthetic gold texts, recorded with store=False."
    )
    payload = {
        "note": note,
        "source": source,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        "recordings": dict(sorted(recordings.items())),
    }
    args.out.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )
    print(f"wrote {len(recordings)} recordings to {args.out}")
    for failure in failures:
        print(f"  failed: {failure}")
    return 1 if failures else 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
