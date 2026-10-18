"""The closed phrase catalogue that fills the v0.2 template placeholders.

`clinical/morpheo_textos_v2_borrador.json` gives, for every [placeholder] of
the v0.2 templates (pp. 11-12) and for Z1's [resumen], a closed list of short
third-person phrases, each selected by an exact answer or rule. The engine picks
them deterministically; no model writes here, and the person's own words never
enter a template -- only the numbers they gave (nights per week, duration).

The loader fails loudly if a template placeholder has no list, if a condition
names a question or option the artifact does not have, or if a phrase is not a
short, finished phrase.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact, FunnelArtifactError, funnel_artifact
from morpheo.funnel.interview import Interview

CATALOGUE_FILE = (
    Path(__file__).resolve().parents[3] / "clinical" / "morpheo_textos_v2_borrador.json"
)
CATALOGUE_STATUS = "BORRADOR \N{EN DASH} Jesús lo aprueba"
# Patient-facing texts v0.2 gives only as system instructions, or not at all.
DRAFT_STATUS = "BORRADOR \N{EN DASH} Jesús"
REQUIRED_DRAFTS = ("S2_aviso", "T_RECIENTE")
MAX_PHRASE_LENGTH = 160
MAX_DRAFT_LENGTH = 600
_PLACEHOLDER = re.compile(r"\[([^\]]+)\]")
_LIST_SLOT = re.compile(r"\{list:([a-z_]+)\}")
_SLOT = re.compile(r"\{([^}]+)\}")
# Resource slots are filled from the artifact's confirmed resources (D-07).
_RESOURCE_SLOTS = {"EMERGENCIA", "S4_extra"}
_PENDING_CODES = {"AGE", "S1", "S2", "S3", "S4", "Q03", "Q05"}
_SAFETY = {"S1", "S2", "S3", "S4"}


@dataclass(frozen=True)
class Phrase:
    id: str
    text: str
    when: Mapping[str, Any] | None
    fallback: bool = False


@dataclass(frozen=True)
class PhraseList:
    name: str
    describes: str
    mode: str  # "all" | "first"
    phrases: tuple[Phrase, ...]
    status: str
    joiner: str | None = None
    choice_key: str | None = None


@dataclass(frozen=True)
class Draft:
    """A whole patient-facing text written for the clinical lead to approve."""

    id: str
    describes: str
    text: str
    status: str


@dataclass(frozen=True)
class Slot:
    list: str
    frame: str | None = None
    empty: str | None = None


@dataclass(frozen=True)
class Catalogue:
    raw: dict[str, Any]
    lists: dict[str, PhraseList]
    placeholders: dict[str, dict[str, Slot]]
    drafts: dict[str, Draft]
    status: str

    def phrase(self, phrase_id: str) -> Phrase:
        for phrase_list in self.lists.values():
            for phrase in phrase_list.phrases:
                if phrase.id == phrase_id:
                    return phrase
        raise KeyError(phrase_id)


@dataclass
class Selection:
    """What a list gave: the phrases' text (slots filled) and their ids."""

    texts: list[str] = field(default_factory=list)
    ids: list[str] = field(default_factory=list)


def _validate_condition(cond: Mapping[str, Any], artifact: FunnelArtifact, where: str) -> None:
    if "all" in cond or ("any" in cond and "q" not in cond):
        for inner in cond.get("all", cond.get("any", [])):
            _validate_condition(inner, artifact, where)
        return
    if "not" in cond:
        _validate_condition(cond["not"], artifact, where)
        return
    if "pending" in cond:
        if cond["pending"] not in _PENDING_CODES:
            raise FunnelArtifactError(f"{where}: unknown pending code {cond['pending']!r}")
        return
    if "x" in cond:
        extracts = {name for s in artifact.steps for name in s.extracts}
        if cond["x"] not in extracts:
            raise FunnelArtifactError(f"{where}: {cond['x']!r} is not extracted by any step")
        return
    if "list" in cond:
        return
    if "safety" in cond:
        if cond["safety"] not in _SAFETY:
            raise FunnelArtifactError(f"{where}: unknown safety question {cond['safety']!r}")
        return
    if "branch" in cond:
        if cond["branch"] not in artifact.engine["branch_order"]:
            raise FunnelArtifactError(f"{where}: unknown branch {cond['branch']!r}")
        return
    if "q" not in cond:
        raise FunnelArtifactError(f"{where}: condition without a question: {cond!r}")
    steps = [s for s in artifact.steps if s.id == cond["q"]]
    if not steps:
        raise FunnelArtifactError(f"{where}: unknown question {cond['q']!r}")
    keys = {o.key for s in steps for o in s.options}
    named = [cond[k] for k in ("has", "is") if k in cond] + list(cond.get("in", []))
    for key in named:
        if keys and key not in keys:
            raise FunnelArtifactError(f"{where}: {cond['q']} has no option {key!r}")
        if not keys and key not in ("si", "no"):
            raise FunnelArtifactError(f"{where}: {cond['q']} answers sí/no, not {key!r}")


def _validate_text(text: str, limit: int, where: str) -> None:
    if "[" in text or "]" in text or len(text) > limit or text != text.strip():
        raise FunnelArtifactError(f"{where}: not a short, finished phrase: {text!r}")
    for slot in _SLOT.findall(text):
        if slot not in ("n", "duración", *_RESOURCE_SLOTS) and not slot.startswith("list:"):
            raise FunnelArtifactError(f"{where}: unknown slot {{{slot}}}")


def parse_catalogue(raw: dict[str, Any], artifact: FunnelArtifact) -> Catalogue:
    status = raw["meta"]["status"]
    if status != CATALOGUE_STATUS:
        raise FunnelArtifactError(f"catalogue status must be {CATALOGUE_STATUS!r}")
    lists: dict[str, PhraseList] = {}
    seen_ids: set[str] = set()
    for name, spec in raw["lists"].items():
        list_status = spec.get("status", status)
        if list_status not in (CATALOGUE_STATUS, DRAFT_STATUS):
            raise FunnelArtifactError(f"list {name}: unknown status {list_status!r}")
        limit = MAX_DRAFT_LENGTH if list_status == DRAFT_STATUS else MAX_PHRASE_LENGTH
        phrases = []
        for p in spec["phrases"]:
            where = f"phrase {p['id']}"
            if p["id"] in seen_ids:
                raise FunnelArtifactError(f"{where}: duplicate id")
            seen_ids.add(p["id"])
            text = p["text"]
            _validate_text(text, limit, where)
            if p.get("when") is not None:
                _validate_condition(p["when"], artifact, where)
            phrases.append(Phrase(p["id"], text, p.get("when"), p.get("fallback", False)))
        if spec["mode"] not in ("all", "first"):
            raise FunnelArtifactError(f"list {name}: mode must be 'all' or 'first'")
        lists[name] = PhraseList(
            name=name,
            describes=spec["describes"],
            mode=spec["mode"],
            phrases=tuple(phrases),
            status=list_status,
            joiner=spec.get("joiner"),
            choice_key=spec.get("choice_key"),
        )
    for phrase_list in lists.values():
        for phrase in phrase_list.phrases:
            for ref in _LIST_SLOT.findall(phrase.text):
                if ref not in lists:
                    raise FunnelArtifactError(f"phrase {phrase.id}: unknown list {ref!r}")
    placeholders: dict[str, dict[str, Slot]] = {}
    for template, slots in raw["placeholders"].items():
        placeholders[template] = {}
        for placeholder, spec in slots.items():
            if spec["list"] not in lists:
                raise FunnelArtifactError(f"{template} [{placeholder}]: unknown list")
            placeholders[template][placeholder] = Slot(
                spec["list"], spec.get("frame"), spec.get("empty")
            )
    # Every placeholder of every v0.2 template (and Z1's) must be covered.
    needed = {
        (template, name)
        for template, text in artifact.templates.items()
        for name in _PLACEHOLDER.findall(text)
    }
    needed |= {("Z1", name) for name in _PLACEHOLDER.findall(artifact.step("Z1").text)}
    covered = {(t, n) for t, slots in placeholders.items() for n in slots}
    missing = needed - covered
    if missing:
        raise FunnelArtifactError(f"placeholders without a phrase list: {sorted(missing)}")
    drafts: dict[str, Draft] = {}
    for draft_id, spec in raw.get("drafts", {}).items():
        if spec["status"] != DRAFT_STATUS:
            raise FunnelArtifactError(f"draft {draft_id}: status must be {DRAFT_STATUS!r}")
        _validate_text(spec["text"], MAX_DRAFT_LENGTH, f"draft {draft_id}")
        drafts[draft_id] = Draft(draft_id, spec["describes"], spec["text"], spec["status"])
    absent = [d for d in REQUIRED_DRAFTS if d not in drafts]
    if absent:
        raise FunnelArtifactError(f"drafts missing: {absent}")
    return Catalogue(raw=raw, lists=lists, placeholders=placeholders, drafts=drafts, status=status)


def load_catalogue(
    path: Path = CATALOGUE_FILE, artifact: FunnelArtifact | None = None
) -> Catalogue:
    return parse_catalogue(
        json.loads(path.read_text(encoding="utf-8")), artifact or funnel_artifact()
    )


@lru_cache(maxsize=1)
def funnel_catalogue() -> Catalogue:
    return load_catalogue()


# --- selection ---


_UNITS = {
    "dias": ("día", "días"),
    "semanas": ("semana", "semanas"),
    "meses": ("mes", "meses"),
    "años": ("año", "años"),
    "horas": ("hora", "horas"),
}


def duration_text(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    singular, plural = _UNITS.get(value["unit"], (value["unit"], value["unit"]))
    amount = value["value"]
    return f"{amount} {singular if amount == 1 else plural}"


def join(items: Sequence[str], joiner: str | None = None) -> str:
    if joiner is not None:
        return joiner.join(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " y " + items[-1]


class Selector:
    """Picks phrases for one interview; every choice is recorded by id."""

    def __init__(self, catalogue: Catalogue, iv: Interview, pending: Sequence[str] = ()) -> None:
        self.c = catalogue
        self.iv = iv
        self.pending = tuple(pending)
        self.resources: Mapping[str, str] = iv.a.engine["resources"]
        self.used: list[str] = []

    def _resources(self, text: str) -> str:
        for slot in _RESOURCE_SLOTS:
            text = text.replace(f"{{{slot}}}", self.resources[slot])
        return text

    def draft(self, draft_id: str) -> str:
        if draft_id not in self.used:
            self.used.append(draft_id)
        return self._resources(self.c.drafts[draft_id].text)

    def holds(self, cond: Mapping[str, Any] | None) -> bool:
        if cond is None:
            return False
        iv = self.iv
        if "all" in cond:
            return all(self.holds(inner) for inner in cond["all"])
        if "any" in cond and "q" not in cond:
            return any(self.holds(inner) for inner in cond["any"])
        if "not" in cond:
            return not self.holds(cond["not"])
        if "pending" in cond:
            return cond["pending"] in self.pending
        if "x" in cond:
            return bool(iv.extracted(cond["x"]))
        if "list" in cond:
            return bool(self._choose(self.c.lists[cond["list"]]))
        if "branch" in cond:
            return iv.branch_open(cond["branch"])
        if "safety" in cond:
            return iv.safety(cond["safety"]) == "si"
        value = iv.value(cond["q"])
        if "has" in cond:
            return isinstance(value, list) and cond["has"] in value
        if "is" in cond:
            return bool(value == cond["is"])
        if "in" in cond:
            return value in cond["in"]
        if "answered" in cond:
            given = iv.answer(cond["q"])
            return given is not None and given.value == cond["answered"]
        if "between" in cond:
            low, high = cond["between"]
            return isinstance(value, int) and low <= value <= high
        if "duration" in cond:
            return duration_text(value) is not None
        if "any" in cond:
            return isinstance(value, list) and len(value) > 0
        if "unknown" in cond:
            return value is None
        raise FunnelArtifactError(f"unknown condition {cond!r}")

    def _choose(self, phrase_list: PhraseList) -> list[Phrase]:
        if phrase_list.choice_key:
            chosen = self.iv.answers.get(phrase_list.choice_key)
            ids = {p.id: p for p in phrase_list.phrases if not p.fallback}
            if chosen is not None and chosen.value in ids:
                return [ids[chosen.value]]
        matched = [p for p in phrase_list.phrases if not p.fallback and self.holds(p.when)]
        if phrase_list.mode == "first":
            matched = matched[:1]
        if matched:
            return matched
        fallbacks = [
            p for p in phrase_list.phrases if p.fallback and (p.when is None or self.holds(p.when))
        ]
        return fallbacks[:1]

    def _fill(self, phrase: Phrase) -> str:
        text = phrase.text
        question = (phrase.when or {}).get("q")
        if question is not None:
            value = self.iv.value(question)
            text = text.replace("{n}", str(value)).replace("{duración}", duration_text(value) or "")
        for ref in _LIST_SLOT.findall(text):
            text = text.replace(f"{{list:{ref}}}", self.text(ref) or "")
        return self._resources(text)

    def select(self, list_name: str) -> Selection:
        phrase_list = self.c.lists[list_name]
        out = Selection()
        for phrase in self._choose(phrase_list):
            out.texts.append(self._fill(phrase))
            out.ids.append(phrase.id)
        for phrase_id in out.ids:
            if phrase_id not in self.used:
                self.used.append(phrase_id)
        return out

    def text(self, list_name: str) -> str | None:
        selection = self.select(list_name)
        if not selection.texts:
            return None
        return join(selection.texts, self.c.lists[list_name].joiner)

    def placeholder(self, template: str, name: str) -> str | None:
        slot = self.c.placeholders[template][name]
        joined = self.text(slot.list)
        if joined is None:
            return slot.empty
        return slot.frame.replace("{list}", joined) if slot.frame else joined
