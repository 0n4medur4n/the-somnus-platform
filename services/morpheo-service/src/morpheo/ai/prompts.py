"""What the model is asked, and the strict JSON schema its answer must fit.

The questions, option keys and safety questions come from the v0.2 artifact,
word for word; the instructions only say how to read the text (explicit facts
only, the exact words as evidence, unknown is never "no"). Bump
`PROMPT_VERSION` on any change here: the recorded fixtures and the audit events
carry it.
"""

from __future__ import annotations

import json
from typing import Any

from morpheo.funnel.artifact import FunnelArtifact
from morpheo.funnel.extraction import RISK_QUESTIONS, RISK_VALUES, Target

PROMPT_VERSION = "extraccion-v2.0-2"
SCHEMA_NAME = "extraccion_relato"

SYSTEM = """Eres un extractor de datos para una entrevista sobre el sueño de personas adultas.
Recibes UNA respuesta libre de la persona y una lista cerrada de preguntas.
Devuelves solo JSON con el esquema dado. No diagnosticas, no puntúas, no decides urgencia
ni orientación: solo copias lo que la persona ha dicho.

items:
1. Incluye un item solo si el texto lo dice de forma explícita. No deduzcas, no supongas,
   no completes. Si no lo dice, no lo incluyas: que falte no significa «no».
2. "evidence": copia literal y exacta de las palabras del texto que lo dicen, sin cambiar
   ni una letra, tilde o signo.
3. «no» solo cuando la persona lo niega expresamente («no ronco»).
4. Listas: solo las opciones que el texto menciona, nunca una lista vacía.
5. Cansancio («me falta energía») no es quedarse dormido sin querer («me duermo sin querer»).
6. Números, duraciones y horas solo si se dicen («seis meses», «a las 23:00»).
   «Casi todas las noches» o «hace tiempo» no son un número.
7. Q14: cada parte solo si se nombra. Las marcas (bipolaridad, epilepsia, embarazo, opioides,
   sustancias, medicacion) solo si se dicen expresamente: no las deduzcas de un medicamento.
8. Las marcas [PERSONA_1], [LUGAR_1]… sustituyen datos personales: cópialas tal cual.

risk: para S1, S4 y S2, "si" si el texto podría apuntar a esa situación, "no" si claramente
no, "dudoso" si no estás seguro. Ante la duda, "dudoso"."""


def _describe(target: Target, labels: dict[str, str]) -> str:
    line = f"- {target.id} ({target.type}): «{target.text}»"
    if target.type in ("multi", "single"):
        options = ", ".join(f"{k} = «{labels.get(k, k)}»" for k in target.options)
        line += f" opciones: {options}"
    elif target.type in ("yes_no", "yes_no_note"):
        line += " valor: si | no"
    elif target.type == "times":
        fields = ", ".join(f"{k} = «{labels.get(k, k)}»" for k in target.fields)
        line += f" campos: {fields}; hora HH:MM"
    elif target.type == "duration":
        line += f" unidades: {', '.join(target.units)}"
    elif target.type == "number":
        line += " valor: número entero"
    elif target.type == "q14_flag":
        line += " valor: si"
    else:
        line += " valor: las mismas palabras que evidence"
    return line


def user_message(
    artifact: FunnelArtifact, source_text: str, text: str, targets: tuple[Target, ...]
) -> str:
    safety = "\n".join(f"- {q}: «{artifact.step(q, 'end').text}»" for q in RISK_QUESTIONS)
    labels = {o.key: o.label for d in artifact.steps for o in (*d.options, *d.fields)}
    labels["ninguna"] = "ninguna de estas"
    questions = (
        "\n".join(_describe(t, labels) for t in targets)
        if targets
        else "(ninguna: solo el riesgo; items vacío)"
    )
    return (
        f"Pregunta que respondió la persona: «{source_text}»\n\n"
        f"Respuesta de la persona:\n<<<\n{text}\n>>>\n\n"
        f"Preguntas que el texto puede responder:\n{questions}\n\n"
        f"Preguntas de seguridad para risk:\n{safety}"
    )


def _value_schema(target: Target) -> dict[str, Any]:
    t = target.type
    if t in ("yes_no", "yes_no_note"):
        return {"type": "string", "enum": ["si", "no"]}
    if t == "single":
        return {"type": "string", "enum": list(target.options)}
    if t == "multi":
        return {"type": "array", "items": {"type": "string", "enum": list(target.options)}}
    if t == "number":
        return {"type": "integer"}
    if t == "duration":
        return {
            "type": "object",
            "additionalProperties": False,
            "required": ["amount", "unit"],
            "properties": {
                "amount": {"type": "number"},
                "unit": {"type": "string", "enum": list(target.units)},
            },
        }
    if t == "times":
        return {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["field", "time"],
                "properties": {
                    "field": {"type": "string", "enum": list(target.fields)},
                    "time": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
                },
            },
        }
    if t == "q14_flag":
        return {"type": "string", "enum": ["si"]}
    return {"type": "string"}


def _item_schema(target_id: str, value: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["id", "value", "evidence"],
        "properties": {
            "id": {"type": "string", "enum": [target_id]},
            "value": value,
            "evidence": {"type": "string"},
        },
    }


def response_schema(targets: tuple[Target, ...]) -> dict[str, Any]:
    """One item shape per question (anyOf), so each value is typed by its question."""
    shapes = [_item_schema(t.id, _value_schema(t)) for t in targets] or [
        _item_schema("NINGUNO", {"type": "string"})
    ]
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["items", "risk"],
        "properties": {
            "items": {"type": "array", "items": {"anyOf": shapes}},
            "risk": {
                "type": "object",
                "additionalProperties": False,
                "required": list(RISK_QUESTIONS),
                "properties": {
                    q: {"type": "string", "enum": list(RISK_VALUES)} for q in RISK_QUESTIONS
                },
            },
        },
    }


def fingerprint(system: str, user: str, schema: dict[str, Any]) -> str:
    """The exact request, as one string: what the input hash and fixtures key on."""
    return json.dumps(
        {"system": system, "user": user, "schema": schema}, ensure_ascii=False, sort_keys=True
    )


__all__ = ["PROMPT_VERSION", "SYSTEM", "fingerprint", "response_schema", "user_message"]
