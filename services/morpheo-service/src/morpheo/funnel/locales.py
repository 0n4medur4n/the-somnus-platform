"""The same interview in Catalan, English and French (owner decision 21/11/2026).

Spanish is the source: `morpheo_embudo_v2.json`, `morpheo_textos_v2.json` and
`morpheo_informe_v3.json`. Each other language is one overlay,
`clinical/i18n/morpheo_v2.<locale>.json`, that gives other words to the same
things: every step's text, option and field labels and unit; every template;
every phrase, draft and frame of the catalogue; the report's own sentences; the
words the engine writes itself (`Lang`); and that language's risk terms.

Steps, option keys, rules, branches, priorities and conditions are not in an
overlay and cannot be: the localized artifact is the Spanish one with its words
replaced, so the same answers give the same result in every language. The
loader refuses an overlay that leaves any text out or names a step, option,
template or phrase the Spanish artifact does not have.

Catalan comes from the clinical lead's plain-language edition
(`Morpheo_algoritmo_embudo_v02_ca.pdf`, 21/11/2026): a step whose text is his
says which item (`verbatim`), and the loader checks the text is literally in
the transcription of that item (`source`). A screen his edition does not write
says why (`draft`). English and French are translations of the Spanish
artifact (`meta.kind = "translation"`), pending review.

Risk terms add up: a localized interview screens free text for the Spanish
terms and its own, so a word in either language asks the safety question.
"""

from __future__ import annotations

import copy
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Any

from morpheo.funnel.artifact import (
    SPANISH,
    FunnelArtifact,
    FunnelArtifactError,
    Lang,
    Option,
    StepDef,
    funnel_artifact,
)
from morpheo.funnel.catalogue import (
    CATALOGUE_FILE,
    Catalogue,
    funnel_catalogue,
    parse_catalogue,
)
from morpheo.funnel.informe import INFORME_FILE, InformeArtifact, informe_artifact
from morpheo.funnel.informe import parse as parse_informe

DEFAULT_LOCALE = "es"
LOCALES = ("es", "ca", "en", "fr")
I18N_DIR = Path(__file__).resolve().parents[3] / "clinical" / "i18n"
_PLACEHOLDER = re.compile(r"\[([^\]]+)\]")
_KINDS = ("clinical_edition", "translation")


def enabled_locales(setting: str) -> frozenset[str]:
    """FUNNEL_LOCALES ("es,ca,en,fr") as a set; an unknown language stops the service."""
    given = {part.strip() for part in setting.split(",") if part.strip()}
    unknown = given - set(LOCALES)
    if unknown:
        raise ValueError(f"FUNNEL_LOCALES names unknown languages: {sorted(unknown)}")
    return frozenset(given | {DEFAULT_LOCALE})


def overlay_file(locale: str) -> Path:
    return I18N_DIR / f"morpheo_v2.{locale}.json"


@dataclass(frozen=True)
class Bundle:
    """What the engine needs to run one interview in one language."""

    artifact: FunnelArtifact
    catalogue: Catalogue
    informe: InformeArtifact


def _rename(text: str, renames: Mapping[str, Any], where: str) -> str:
    """Jesús's placeholder names to the catalogue's ([dificultat] -> [dificultad]).

    A rename may also be a fixed text (`{"fixed": …}`) where the edition has a
    placeholder the Spanish template writes out.
    """
    unknown = set(renames) - set(_PLACEHOLDER.findall(text))
    if unknown:
        raise FunnelArtifactError(f"{where}: unknown placeholders {sorted(unknown)}")
    for name, target in renames.items():
        if isinstance(target, Mapping):
            text = text.replace(f"[{name}]", target["fixed"])
        else:
            text = text.replace(f"[{name}]", f"[{target}]")
    return text


def _lang(locale: str, ui: Mapping[str, Any]) -> Lang:
    missing = {f for f in SPANISH.__dataclass_fields__ if f != "locale"} - set(ui)
    if missing:
        raise FunnelArtifactError(f"{locale}: ui is missing {sorted(missing)}")
    units = {key: (pair[0], pair[1]) for key, pair in ui["units"].items()}
    if set(units) != set(SPANISH.units):
        raise FunnelArtifactError(f"{locale}: ui.units must name {sorted(SPANISH.units)}")
    if set(ui["q14_parts"]) != set(SPANISH.q14_parts):
        raise FunnelArtifactError(f"{locale}: ui.q14_parts must name {sorted(SPANISH.q14_parts)}")
    return Lang(
        locale=locale,
        yes=ui["yes"],
        no=ui["no"],
        unknown=ui["unknown"],
        prefer=ui["prefer"],
        same=ui["same"],
        changed=ui["changed"],
        none_of_these=ui["none_of_these"],
        read=ui["read"],
        units=units,
        conjunction=ui["conjunction"],
        confirm_text=ui["confirm_text"],
        confirm_question=ui["confirm_question"],
        q14_question=ui["q14_question"],
        q14_parts=dict(ui["q14_parts"]),
    )


def _labels(
    options: tuple[Option, ...], given: Mapping[str, str] | None, where: str
) -> tuple[Option, ...]:
    if not options:
        if given:
            raise FunnelArtifactError(f"{where}: the Spanish step has none")
        return ()
    given = given or {}
    if set(given) != {o.key for o in options}:
        raise FunnelArtifactError(f"{where}: labels must name exactly {[o.key for o in options]}")
    return tuple(Option(o.key, given[o.key]) for o in options)


def _step(d: StepDef, spec: Mapping[str, Any], ov: Mapping[str, Any]) -> StepDef:
    where = f"{ov['meta']['locale']} step {d.id}"
    text = spec["text"]
    verbatim = spec.get("verbatim")
    if verbatim is not None:
        item = ov["source"].get(verbatim)
        if item is None or text not in item["text"]:
            raise FunnelArtifactError(f"{where}: {text!r} is not literally in {verbatim}")
    elif ov["meta"]["kind"] == "clinical_edition" and not spec.get("draft"):
        raise FunnelArtifactError(f"{where}: neither verbatim nor a draft that says why")
    text = _rename(text, spec.get("placeholders", {}), where)
    if _PLACEHOLDER.findall(text) != _PLACEHOLDER.findall(d.text):
        raise FunnelArtifactError(f"{where}: placeholders differ from the Spanish step")
    if bool(d.unit) != bool(spec.get("unit")):
        raise FunnelArtifactError(f"{where}: unit must be given exactly when Spanish has one")
    return replace(
        d,
        text=text,
        note=None,
        options=_labels(d.options, spec.get("options"), f"{where} options"),
        retired_options=_labels(d.retired_options, spec.get("retired_options"), f"{where} retired"),
        fields=_labels(d.fields, spec.get("fields"), f"{where} fields"),
        unit=spec.get("unit"),
        draft=spec.get("draft") or d.draft,
    )


def localize_artifact(base: FunnelArtifact, ov: Mapping[str, Any]) -> FunnelArtifact:
    locale = ov["meta"]["locale"]
    if ov["meta"].get("kind") not in _KINDS:
        raise FunnelArtifactError(f"{locale}: meta.kind must be one of {_KINDS}")
    specs: Mapping[str, Any] = ov["steps"]
    ids = {d.id for d in base.steps}
    if set(specs) != ids:
        raise FunnelArtifactError(
            f"{locale}: steps missing {sorted(ids - set(specs))}, "
            f"unknown {sorted(set(specs) - ids)}"
        )
    steps = tuple(_step(d, specs[d.id], ov) for d in base.steps)
    templates: dict[str, str] = {}
    for key, spec in ov["templates"].items():
        if key not in base.templates:
            raise FunnelArtifactError(f"{locale}: unknown template {key!r}")
        if spec.get("verbatim"):
            item = ov["source"].get(spec["verbatim"])
            if item is None or spec["text"] != item["text"]:
                raise FunnelArtifactError(f"{locale} {key}: not what {spec['verbatim']} says")
        text = _rename(spec["text"], spec.get("placeholders", {}), f"{locale} {key}")
        if set(_PLACEHOLDER.findall(text)) != set(_PLACEHOLDER.findall(base.templates[key])):
            raise FunnelArtifactError(f"{locale} {key}: placeholders differ from Spanish")
        templates[key] = text
    if set(templates) != set(base.templates):
        raise FunnelArtifactError(
            f"{locale}: templates missing {sorted(set(base.templates) - set(templates))}"
        )
    raw = copy.deepcopy(base.raw)
    source = raw["source"]
    source["localized"] = {"meta": ov["meta"], "items": ov["source"]}
    if len(ov["sources"]) != len(source["sources"]["items"]):
        raise FunnelArtifactError(f"{locale}: sources must list the same {len(ov['sources'])}")
    source["sources"]["items"] = list(ov["sources"])
    source["protection"]["text"] = specs["PROT"]["text"]
    engine = raw["engine"]
    resources = ov["resources"]
    if set(resources) != {k for k in engine["resources"] if k != "default"}:
        raise FunnelArtifactError(f"{locale}: resources must name the same codes")
    engine["resources"].update(resources)
    for question, terms in ov["risk_terms"].items():
        if question not in engine["risk_terms"] or question == "default":
            raise FunnelArtifactError(f"{locale}: no risk question {question!r}")
        engine["risk_terms"][question] = [*engine["risk_terms"][question], *terms]
    # The Spanish agreement fix (D-31) is Spanish only.
    engine["template_overrides"] = []
    return FunnelArtifact(
        raw=raw,
        steps=steps,
        templates=templates,
        content_version=base.content_version,
        rules_version=base.rules_version,
        lang=_lang(locale, ov["ui"]),
    )


def localize_catalogue(raw: Mapping[str, Any], ov: Mapping[str, Any]) -> dict[str, Any]:
    locale = ov["meta"]["locale"]
    out = copy.deepcopy(dict(raw))
    phrases: Mapping[str, str] = ov["phrases"]
    seen: set[str] = set()
    for spec in out["lists"].values():
        for phrase in spec["phrases"]:
            if phrase["id"] not in phrases:
                raise FunnelArtifactError(f"{locale}: phrase {phrase['id']} has no text")
            phrase["text"] = phrases[phrase["id"]]
            seen.add(phrase["id"])
    if set(phrases) - seen:
        raise FunnelArtifactError(f"{locale}: unknown phrases {sorted(set(phrases) - seen)}")
    for draft_id, spec in out["drafts"].items():
        if draft_id not in ov["drafts"]:
            raise FunnelArtifactError(f"{locale}: text {draft_id} has no translation")
        spec["text"] = ov["drafts"][draft_id]
    for template, slots in out["placeholders"].items():
        for name, slot in slots.items():
            for part in ("frame", "empty"):
                if part in slot:
                    given = ov["frames"].get(f"{template}/{name}", {}).get(part)
                    if given is None:
                        raise FunnelArtifactError(f"{locale}: {template} [{name}] has no {part}")
                    slot[part] = given
    return out


def localize_informe(raw: Mapping[str, Any], ov: Mapping[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(dict(raw))
    given = ov["informe"]
    out["accion"] = {
        key: value for key, value in raw["accion"].items() if key.startswith("_")
    } | given["accion"]
    if set(given["accion"]) != {k for k in raw["accion"] if not k.startswith("_")}:
        raise FunnelArtifactError(f"{ov['meta']['locale']}: informe.accion names other templates")
    out["pasos"]["diario_y_revision"]["texto"] = given["pasos"]
    out["ayuda"]["frases"] = list(given["ayuda"])
    out["limites"]["frases"] = list(given["limites"])
    return out


def load_overlay(locale: str) -> dict[str, Any]:
    ov: dict[str, Any] = json.loads(overlay_file(locale).read_text(encoding="utf-8"))
    if ov["meta"]["locale"] != locale:
        raise FunnelArtifactError(f"{overlay_file(locale).name}: meta.locale is not {locale!r}")
    return ov


@lru_cache(maxsize=len(LOCALES))
def bundle(locale: str) -> Bundle:
    """The interview in `locale` (Spanish for anything else), checked and cached."""
    if locale == DEFAULT_LOCALE or locale not in LOCALES:
        return Bundle(funnel_artifact(), funnel_catalogue(), informe_artifact())
    ov = load_overlay(locale)
    artifact = localize_artifact(funnel_artifact(), ov)
    catalogue_raw = json.loads(CATALOGUE_FILE.read_text(encoding="utf-8"))
    catalogue = parse_catalogue(localize_catalogue(catalogue_raw, ov), artifact)
    informe_raw = json.loads(INFORME_FILE.read_text(encoding="utf-8"))
    informe = parse_informe(localize_informe(informe_raw, ov), artifact, catalogue)
    return Bundle(artifact, catalogue, informe)


__all__ = [
    "DEFAULT_LOCALE",
    "LOCALES",
    "Bundle",
    "bundle",
    "enabled_locales",
    "load_overlay",
    "localize_artifact",
]
