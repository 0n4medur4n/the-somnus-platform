"""The person's report, written live by the AI from the protocol (§15 amended).

Owner decision 2026-10-16: each assessment gets a report written for the person
by the configured model (GPT-6 Luna) and shown without human review. What keeps
it safe is what the model is given and what is done with its answer:

* **It decides nothing.** The level, the routing and the fired rules come from
  Morpheo's deterministic engine and are only *described* to the model. The
  urgent instructions (the fired rules' messages) are printed by the app and the
  PDF verbatim, outside the AI text.
* **L0 is never sent to a model.** An emergency is shown at once, in the
  protocol's words.
* **It never sees the person.** No name, email, id or free text: only the level,
  the routed patterns and the protocol's own wording for them.
* **Its answer is checked before anyone reads it.** It must parse into the
  bounded NarrativeDTO and pass the forbidden-phrase scanner (forbidden phrases
  and every BLOQUEAR claim). Anything else is discarded and the person reads the
  protocol's text instead -- a failed or refused generation is never an error.
* **Written once.** Stored per assessment and language, so the screen and the
  PDF show the same text and the model is called once.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Protocol

from pydantic import ValidationError

from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.llm.audit import build_audit, log_generation
from report.infrastructure.llm.provider import LlmProvider, LlmRequest
from report.schemas.narrative import NarrativeDTO, NarrativeResponseDTO
from report.schemas.render import ClinicalContentDTO, ReportRenderRequestDTO

logger = logging.getLogger("report.narrative")

PROMPT_ID = "person_report"
PROMPT_VERSION = "person_report_v2"

_LANGUAGE = {"es": "español", "en": "English", "ca": "català", "fr": "français"}

_AUDIENCE = {
    "adult": "la propia persona adulta; háblale de tú, sobre sí misma",
    "parent": "la madre, el padre o el tutor; háblale de tú, sobre «tu hijo o hija»",
    "professional": (
        "un profesional sanitario que valora un caso anonimizado; tono profesional, "
        "sobre «la persona valorada»"
    ),
}

_SYSTEM = """Eres el redactor de informes de The Somnus (orientación sobre el sueño).
Escribes el informe final que leerá {audience}, en {language}, claro, cercano y útil.

Reglas que no puedes romper:
- Usa SOLO los datos del mensaje. No inventes hechos, cifras, enfermedades ni causas.
- No diagnostiques ni descartes nada. No escribas NUNCA la palabra «tienes» (ni
  «no tienes»), en ninguna frase: di «has comunicado», «te ocurre», «notas», «si te
  surgen dudas».
- El nivel de atención ya está decidido: descríbelo, no lo cambies ni lo suavices.
- Las instrucciones urgentes («urgentMessages») ya figuran en el informe con sus
  palabras exactas: no las copies ni las contradigas, y NO digas que aparecen en otro
  sitio ni «por separado».
- Habla directamente a quien lee. No menciones el sistema, el protocolo, las reglas,
  los datos recibidos ni que el nivel ha sido «asignado»: di, por ejemplo, «Lo
  indicado es una valoración urgente hoy».
- No recomiendes empezar, dejar ni cambiar medicamentos o dosis.
- Las recomendaciones salen SOLO de la acción del nivel y de las reglas del protocolo
  de cada patrón, convertidas en pasos prácticos para quien lee.
- «Qué preparar»: convierte las preguntas del profesional en cosas que anotar antes de
  la consulta («Apunta desde cuándo…»).
- Nunca uses estas frases ni su sentido: {forbidden}

Responde SOLO con un objeto JSON con estas claves:
{{"summary": "2-3 frases sobre lo comunicado y el nivel",
 "whatToDo": ["1 a 3 pasos concretos"],
 "patterns": [{{"name": "nombre del patrón", "why": "por qué conviene valorarlo"}}],
 "recommendations": ["2 a 5 recomendaciones prácticas del protocolo"],
 "prepare": ["3 a 6 cosas que anotar para la consulta"]}}"""

# One answer, and one corrected retry if the guardrail refuses it.
_ATTEMPTS = 2

_CORRECTION = """

Tu respuesta anterior se descartó porque {reason}. Escríbela de nuevo cumpliendo
todas las reglas; no uses en ninguna frase «tienes» ni «no tienes»."""

# Morpheo's module outputs are quoted templates with [placeholders]; the model
# gets the sentence without either, so it never echoes a bracket to a person.
_PLACEHOLDER = re.compile(r"\s*\[[^\]]*\]")


def _clean(text: str) -> str:
    return _PLACEHOLDER.sub("", text).strip().strip('«»"').strip()


class NarrativeStore(Protocol):
    def get(self, assessment_id: str, locale: str) -> NarrativeDTO | None: ...

    def put(
        self,
        assessment_id: str,
        locale: str,
        narrative: NarrativeDTO,
        *,
        content_version: str,
        model_id: str,
        input_hash: str,
    ) -> None: ...


def structured_input(
    request: ReportRenderRequestDTO, content: ClinicalContentDTO
) -> dict[str, Any]:
    """Everything the model sees: the result and the protocol's words. Nothing about who."""
    levels = {level.id: level for level in content.safety_levels}
    modules = {module.id: module for module in content.modules}
    rules = {rule.id: rule for rule in content.safety_rules}
    level = levels.get(request.level) if request.level else None
    return {
        "level": None
        if level is None
        else {"id": level.id, "name": level.name, "protocolAction": level.action},
        "urgentMessages": [
            rules[rule_id].message for rule_id in request.triggered_rules if rule_id in rules
        ],
        "patterns": [
            {
                "name": modules[route].name,
                "protocolSummary": _clean(modules[route].output),
                "protocolRules": list(modules[route].rules),
                "professionalQuestions": list(modules[route].minimum_questions),
            }
            for route in request.routes
            if route in modules
        ][:3],
        "limits": list(content.limits_text),
    }


class NarrativeService:
    def __init__(
        self,
        *,
        provider: LlmProvider | None,
        store: NarrativeStore,
        chat_model: str,
        reasoning_effort: str | None,
        temperature: float,
    ) -> None:
        self._provider = provider
        self._store = store
        self._model = chat_model
        self._effort = reasoning_effort
        self._temperature = temperature

    def for_assessment(
        self, request: ReportRenderRequestDTO, content: ClinicalContentDTO
    ) -> NarrativeResponseDTO:
        """The stored report, or a new one written now. Never raises for the model."""
        none = NarrativeResponseDTO(
            assessment_id=request.assessment_id, locale=request.locale, generated=False
        )
        # An emergency is the protocol's words, at once. No model, ever.
        if request.level == "L0" or self._provider is None:
            return none
        stored = self._store.get(request.assessment_id, request.locale)
        if stored is not None:
            return none.model_copy(update={"generated": True, "narrative": stored})

        data = structured_input(request, content)
        written = self._write(request, content, data)
        if written is None:
            return none
        narrative, model_id, input_text = written
        self._store.put(
            request.assessment_id,
            request.locale,
            narrative,
            content_version=request.content_version,
            model_id=model_id,
            input_hash=build_audit(
                model=model_id,
                template_version=PROMPT_VERSION,
                prompt_template_id=PROMPT_ID,
                structured_input=input_text,
                response_text="",
                review_status="published",
            ).input_hash,
        )
        return none.model_copy(update={"generated": True, "narrative": narrative})

    def _write(
        self,
        request: ReportRenderRequestDTO,
        content: ClinicalContentDTO,
        data: dict[str, Any],
    ) -> tuple[NarrativeDTO, str, str] | None:
        """Ask the model, check the answer; one corrected retry, then give up.

        The scanner is deliberately broad ("Tienes [diagnóstico]." catches any
        "tienes …"), and it is the guardrail, so it is not loosened. A refused
        answer gets ONE retry that names the governed phrase it hit -- never the
        text -- and if that fails too, the person reads the protocol's wording.
        """
        assert self._provider is not None
        forbidden = [*content.output_contract.forbidden_phrases, *content.blocked_claims]
        system = _SYSTEM.format(
            audience=_AUDIENCE.get(request.role, _AUDIENCE["adult"]),
            language=_LANGUAGE.get(request.locale, "español"),
            forbidden="; ".join(forbidden),
        )
        user = json.dumps(data, ensure_ascii=False)
        scanner = ForbiddenPhraseScanner(
            forbidden_phrases=list(content.output_contract.forbidden_phrases),
            blocked_claims=list(content.blocked_claims),
        )
        correction = ""
        for _attempt in range(_ATTEMPTS):
            try:
                response = self._provider.complete(
                    LlmRequest(
                        system=system,
                        user=user + correction,
                        model=self._model,
                        temperature=self._temperature,
                        reasoning_effort=self._effort,
                        json_output=True,
                    )
                )
            except Exception as exc:
                logger.warning(
                    "person report not written: model call failed (%s)", type(exc).__name__
                )
                return None

            status = "published"
            hits: list[str] = []
            narrative: NarrativeDTO | None = None
            try:
                narrative = NarrativeDTO.model_validate_json(response.text)
            except ValidationError:
                status = "rejected_shape"
            if narrative is not None:
                hits = scanner.scan(_all_text(narrative))
                if hits:
                    status = "rejected_forbidden"
                    narrative = None
            # §15 logging: hashes only, never the health text.
            log_generation(
                build_audit(
                    model=response.model,
                    template_version=PROMPT_VERSION,
                    prompt_template_id=PROMPT_ID,
                    structured_input=user,
                    response_text=response.text,
                    review_status=status,
                )
            )
            if narrative is not None:
                return narrative, response.model, user
            # Governed phrases only: safe to log and to hand back to the model.
            logger.warning(
                "person report refused",
                extra={"personReport": {"status": status, "governedPhrases": hits}},
            )
            correction = _CORRECTION.format(
                reason=(
                    "contenía expresiones prohibidas: " + "; ".join(hits)
                    if hits
                    else "no era un JSON con las claves y límites pedidos"
                )
            )
        return None


def _all_text(narrative: NarrativeDTO) -> str:
    parts = [
        narrative.summary,
        *narrative.what_to_do,
        *(f"{pattern.name}. {pattern.why}" for pattern in narrative.patterns),
        *narrative.recommendations,
        *narrative.prepare,
    ]
    return "\n".join(parts)
