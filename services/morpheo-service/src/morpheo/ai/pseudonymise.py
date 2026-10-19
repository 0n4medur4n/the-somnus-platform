"""Reversible pseudonymisation of a free text before it goes to the model.

Names, places, organisations, health centres, dates, addresses, phones, emails
and DNI/NIE are replaced by markers (`[PERSONA_1]`, `[LUGAR_1]`, …); the model
sees only the marked text and every marker is put back afterwards, evidence
spans included. Detection runs locally: deterministic rules plus spaCy's
Spanish NER (`es_core_news_md`, approved 19/10/2026). Nothing leaves the
service to be detected.

This is pseudonymisation, not anonymisation (GDPR art. 4.5): it reduces what
the model sees. Its known limits are measured in tests/unit/ai on the 28
annotated synthetic narratives of the 18/10/2026 proposal.

The map never leaves this process: it lives only for the duration of one call.
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from spacy.language import Language

SPACY_MODEL = "es_core_news_md"

_CTRL = "[A-HJ-NP-TV-Za-hj-np-tv-z]"
_UP = "A-ZÁÉÍÓÚÑÀÈÒÏÜÇ"
_NAME = rf"[{_UP}][\wáéíóúñàèòïüç'·-]+"
_MONTHS = (
    "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|"
    "noviembre|diciembre"
)
_KIN = (
    "marido|mujer|pareja|esposo|esposa|novio|novia|hijo|hija|hermano|hermana|madre|padre|"
    "vecino|vecina|compañer[oa](?: de piso)?|amig[oa]"
)
_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("EMAIL", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
    (
        "TELEFONO",
        re.compile(r"(?<![0-9])(?:(?:\+|00)[0-9]{1,3}[\s.-]?)?[6-9](?:[\s.-]?[0-9]){8}(?![0-9])"),
    ),
    (
        "DNI",
        re.compile(
            rf"(?<![A-Za-z0-9])(?:[0-9]{{8}}|[XYZxyz][0-9]{{7}})[\s-]?{_CTRL}(?![A-Za-z0-9])"
        ),
    ),
    ("FECHA", re.compile(r"\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b")),
    ("FECHA", re.compile(rf"\b\d{{1,2}} de (?:{_MONTHS})(?: de \d{{4}})?\b", re.IGNORECASE)),
    (
        "DIRECCION",
        re.compile(
            r"\b(?:calle|c/|avenida|avda\.?|plaza|pza\.?|paseo|carrer|ronda|camino)\s+"
            rf"(?:de\s+(?:la\s+|los\s+|las\s+)?)?{_NAME}(?:\s+{_NAME})*,?\s*(?:n[º.o]?\s*)?\d+",
            re.IGNORECASE,
        ),
    ),
    (
        "CENTRO",
        re.compile(
            r"\b(?:Hospital(?:\s+Universitario)?|Centro de Salud|Cl[íi]nica|CAP|ABS|Ambulatorio|"
            r"ambulatorio|Policl[íi]nica|Mutua|Unidad del Sueño)(?:\s+(?:de|del|de la|d'))?\s+"
            rf"{_NAME}(?:\s+(?:de|del|i|y)?\s*{_NAME})*"
        ),
    ),
    (
        "PERSONA",
        re.compile(
            r"\b(?:[Dd]octora?|[Dd]ra?\.|[Ee]nfermer[oa]|[Pp]siquiatra|[Pp]sic[óo]log[oa])\s+"
            rf"(?:la\s+|el\s+)?(?:{_NAME})(?:\s+{_NAME})*"
        ),
    ),
    # A kinship word and a name: capitalised, or a lowercase word followed by a
    # reporting verb ("mi pareja pepe dice…"). Only the name is replaced.
    (
        "PERSONA",
        re.compile(
            rf"\b(?:[Mm]i|[Ss]u)\s+(?:{_KIN})\s*,?\s+([a-záéíóúñ]{{3,}}(?=\s+(?:dice|dijo|cuenta|nota|ve)\b)"
            rf"|[{_UP}][\wáéíóúñ]+(?:\s+[{_UP}][\wáéíóúñ]+)*)"
        ),
    ),
    ("PERSONA", re.compile(rf"\b(?:[Mm]e llamo|[Ss]oy)\s+({_NAME}(?:\s+(?:i|y|de)?\s*{_NAME})+)")),
)
_TITLE = re.compile(
    r"^(?:[Dd]octora?|[Dd]ra?\.|[Ee]nfermer[oa]|[Pp]siquiatra|[Pp]sic[óo]log[oa])\s+(?:la\s+|el\s+)?"
)
_SENTENCE_BREAKS = frozenset({".", "!", "?", "¡", "¿", ":", ";"})
_NER_KINDS = {"PER": "PERSONA", "LOC": "LUGAR", "ORG": "ENTIDAD"}
# Medicine names stay visible to the model (they are clinical data, not
# identifiers). A short list for now; the AEMPS nomenclator (CIMA) would
# replace it in production.
MEDICATION_TERMS = frozenset(
    {
        "orfidal",
        "dormidina",
        "lorazepam",
        "melatonina",
        "sertralina",
        "zolpidem",
        "trankimazin",
        "lexatin",
        "noctamid",
        "stilnox",
        "tramadol",
        "litio",
    }
)


@dataclass(frozen=True)
class Pseudonymised:
    text: str
    # marker → original, in order of appearance.
    mapping: tuple[tuple[str, str], ...]

    @property
    def count(self) -> int:
        return len(self.mapping)

    def restore(self, text: str) -> str:
        for marker, original in self.mapping:
            text = text.replace(marker, original)
        return text


_lock = threading.Lock()
_nlp: Language | None = None


def _model() -> Language:
    """The spaCy pipeline, loaded once per process on first use (~1 s)."""
    global _nlp
    with _lock:
        if _nlp is None:
            import spacy

            _nlp = spacy.load(SPACY_MODEL, exclude=["parser", "lemmatizer", "attribute_ruler"])
        return _nlp


def _rule_spans(text: str) -> list[tuple[int, int, str]]:
    spans: list[tuple[int, int, str]] = []
    for kind, pattern in _RULES:
        for match in pattern.finditer(text):
            if match.lastindex:
                start, end = match.span(1)
            else:
                start, end = match.span()
                title = _TITLE.match(text[start:end])
                if kind == "PERSONA" and title:
                    start += title.end()
            spans.append((start, end, kind))
    return spans


def _sentence_initial_word(nlp: Language, ent: Any) -> bool:
    """A capitalised word read as a name only because it opens a sentence
    ("Ronco muy fuerte…"): written in lowercase, it is not a proper noun."""
    if len(ent) != 1:
        return False
    token = ent[0]
    if token.i > 0 and token.nbor(-1).text not in _SENTENCE_BREAKS:
        return False
    rest = token.doc.text[token.idx : token.idx + 200]
    lowered = nlp(rest[:1].lower() + rest[1:])
    return len(lowered) > 0 and lowered[0].pos_ != "PROPN"


def _ner_spans(text: str) -> list[tuple[int, int, str]]:
    nlp = _model()
    spans: list[tuple[int, int, str]] = []
    for ent in nlp(text).ents:
        kind = _NER_KINDS.get(ent.label_)
        if kind is None:
            continue
        # Proper nouns only: drops sentence-initial verbs ("Vivo", "Duermo")
        # and keeps clinical words visible to the model.
        if ent[0].pos_ != "PROPN" or not all(
            t.pos_ in ("PROPN", "ADP", "DET", "CCONJ") for t in ent
        ):
            continue
        if any(t.text.lower() in MEDICATION_TERMS for t in ent):
            continue
        if _sentence_initial_word(nlp, ent):
            continue
        spans.append((ent.start_char, ent.end_char, kind))
    return spans


def _merge(spans: list[tuple[int, int, str]]) -> list[tuple[int, int, str]]:
    kept: list[tuple[int, int, str]] = []
    for start, end, kind in sorted(spans, key=lambda s: (s[0], -(s[1] - s[0]))):
        if kept and start < kept[-1][1]:
            if end > kept[-1][1]:
                kept[-1] = (kept[-1][0], end, kept[-1][2])
            continue
        kept.append((start, end, kind))
    return kept


def pseudonymise(text: str, *, use_ner: bool = True) -> Pseudonymised:
    spans = _rule_spans(text) + (_ner_spans(text) if use_ner else [])
    counters: dict[str, int] = {}
    mapping: dict[str, str] = {}
    out: list[str] = []
    last = 0
    for start, end, kind in _merge(spans):
        original = text[start:end]
        marker = next((m for m, v in mapping.items() if v == original), None)
        if marker is None:
            counters[kind] = counters.get(kind, 0) + 1
            marker = f"[{kind}_{counters[kind]}]"
            while marker in text:  # never collide with what the person wrote
                counters[kind] += 1
                marker = f"[{kind}_{counters[kind]}]"
            mapping[marker] = original
        out.append(text[last:start] + marker)
        last = end
    out.append(text[last:])
    return Pseudonymised("".join(out), tuple(mapping.items()))


__all__ = ["MEDICATION_TERMS", "Pseudonymised", "pseudonymise"]
