"""The embudo v0.2 artifact (content 2.0, ADR 0020).

`clinical/morpheo_embudo_v2.json` holds two things:

* `source` -- the verified transcription of Morpheo_algoritmo_embudo_v02.pdf,
  unchanged. Every question, note, rule and template the engine shows comes
  from here, word for word.
* `engine` -- what the engine needs to ask and evaluate: answer types, option
  keys, the split screens of the v0.3 draft and the DEFAULT parameters (D-xx).

The loader fails loudly if an option label or a split screen is not a literal
fragment of its source text: the engine may cut a v0.2 question into screens,
never reword it.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

ARTIFACT_FILE = Path(__file__).resolve().parents[3] / "clinical" / "morpheo_embudo_v2.json"


class FunnelArtifactError(ValueError):
    """The artifact is malformed or rewords v0.2."""


@dataclass(frozen=True)
class Option:
    key: str
    label: str


@dataclass(frozen=True)
class StepDef:
    id: str
    source: str
    stage: str
    type: str
    text: str
    note: str | None
    options: tuple[Option, ...] = ()
    fields: tuple[Option, ...] = ()
    none_option: bool = False
    safety: bool = False
    risk_scan: bool = False
    clarify_once: bool = False
    same_as: str | None = None
    inferred_from: dict[str, Any] | None = None
    then_ask_now: dict[str, Any] | None = None
    extracts: tuple[str, ...] = ()
    unit: str | None = None
    outcomes: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class FunnelArtifact:
    raw: dict[str, Any]
    steps: tuple[StepDef, ...]
    templates: dict[str, str]
    content_version: str
    rules_version: str

    @property
    def engine(self) -> dict[str, Any]:
        engine: dict[str, Any] = self.raw["engine"]
        return engine

    @property
    def protection_text(self) -> str:
        text: str = self.raw["source"]["protection"]["text"]
        return text

    def step(self, step_id: str, stage: str | None = None) -> StepDef:
        for definition in self.steps:
            if definition.id == step_id and (stage is None or definition.stage == stage):
                return definition
        raise KeyError(step_id)


def _source_index(source: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every source item (questions, branch items, S/Z, AGE, PROT) by id."""
    index: dict[str, dict[str, Any]] = {}
    for item in source["questions"]:
        index[item["id"]] = item
    for branch in source["branches"]:
        for item in branch["items"]:
            index[item["id"]] = item
    for item in source["safety_and_close"]["items"]:
        index[item["id"]] = item
    index["AGE"] = {
        "id": "AGE",
        "text": source["age_gate"]["text"].strip("«»"),
        "note": source["age_gate"]["note"],
    }
    index["PROT"] = {
        "id": "PROT",
        "text": source["protection"]["text"],
        "note": source["protection"]["when"],
    }
    return index


def _fragment_of(fragment: str, *texts: str | None) -> bool:
    return any(text is not None and fragment in text for text in texts)


def parse(raw: dict[str, Any]) -> FunnelArtifact:
    source, engine = raw["source"], raw["engine"]
    index = _source_index(source)
    steps: list[StepDef] = []
    for spec in engine["steps"]:
        item = index.get(spec["source"])
        if item is None:
            raise FunnelArtifactError(f"step {spec['id']!r}: unknown source {spec['source']!r}")
        full, note = item["text"], item.get("note")
        text = spec.get("fragment") or full
        if not _fragment_of(text, full):
            raise FunnelArtifactError(
                f"step {spec['id']!r}: {text!r} is not verbatim from {spec['source']}"
            )
        options = tuple(Option(o["key"], o["label"]) for o in spec.get("options", []))
        fields = tuple(Option(o["key"], o["label"]) for o in spec.get("fields", []))
        for o in (*options, *fields):
            if not _fragment_of(o.label, full, note):
                raise FunnelArtifactError(f"step {spec['id']!r}: label {o.label!r} is not verbatim")
        steps.append(
            StepDef(
                id=spec["id"],
                source=spec["source"],
                stage=spec["stage"],
                type=spec["type"],
                text=text,
                note=note,
                options=options,
                fields=fields,
                none_option=spec.get("none_option", False),
                safety=spec.get("safety", False),
                risk_scan=spec.get("risk_scan", False),
                clarify_once=spec.get("clarify_once", False),
                same_as=spec.get("same_as"),
                inferred_from=spec.get("inferred_from"),
                then_ask_now=spec.get("then_ask_now"),
                extracts=tuple(spec.get("extracts", [])),
                unit=spec.get("unit"),
                outcomes=dict(item.get("outcomes", {})),
            )
        )
    templates = {t["id"]: t["text"] for t in source["templates"]}
    # V-16 (p. 11): T_INSOMNIO's extra sentence, said only "si no hay otras
    # señales", lives quoted inside its guidance.
    guidance = next(t["guidance"] for t in source["templates"] if t["id"] == "T_INSOMNIO")
    quoted = re.search(r"«(.+?)»", guidance)
    if quoted is None:
        raise FunnelArtifactError("T_INSOMNIO guidance has no quoted sentence")
    templates["T_INSOMNIO.sin_otras_senales"] = quoted.group(1)
    for override in engine.get("template_overrides", []):
        key = override["template"]
        text = templates[key]
        if override["from"] not in text:
            raise FunnelArtifactError(
                f"override {override['default']}: {override['from']!r} not found"
            )
        templates[key] = text.replace(override["from"], override["to"])
    return FunnelArtifact(
        raw=raw,
        steps=tuple(steps),
        templates=templates,
        content_version=engine["content_version"],
        rules_version=engine["rules_version"],
    )


def load(path: Path = ARTIFACT_FILE) -> FunnelArtifact:
    return parse(json.loads(path.read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def funnel_artifact() -> FunnelArtifact:
    return load()
