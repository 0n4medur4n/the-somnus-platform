"""Controlled AI wording (build plan §15 / Checkpoint 11.2).

The LLM ONLY rewrites already-approved prose in plain language. It never sees or
returns the level, the safety flags, or the routing — those are the deterministic
result, stamped separately — so the AI cannot alter them. Its output is scanned
for forbidden phrases / BLOQUEAR claims and flagged `pending_review`. The rewriter
can never mark text approved.

Status (Checkpoint 11.2): this class is NOT wired into the render pipeline and AI
rewriting is disabled by `AI_REWRITE_ENABLED` (default off; see
report.application.ai_rewrite). `pending_review` is only a status today — no
endpoint, UI, role, or persistence exists to review, approve, or reject the output.
Until such a human-review mechanism is built, no AI text may be served (§15).
"""

from __future__ import annotations

from dataclasses import dataclass

from report.infrastructure.forbidden import ForbiddenPhraseScanner
from report.infrastructure.llm.audit import build_audit, log_generation
from report.infrastructure.llm.provider import LlmProvider, LlmRequest

PENDING_REVIEW = "pending_review"
REJECTED = "rejected"

# Versioned prompt (the id/version are config; see settings). The model is told
# to reword only — never to add diagnoses, diseases, treatments, or new claims.
_SYSTEM_PROMPT = (
    "Reescribe el texto clínico aprobado en lenguaje llano y cercano, sin cambiar su "
    "significado. No añadas diagnósticos, enfermedades, tratamientos ni afirmaciones "
    "nuevas. No inventes datos ni des cifras. Devuelve solo el texto reescrito."
)


@dataclass(frozen=True)
class RewriteResult:
    # The reworded prose (pending review), or None when the guardrail rejected it.
    text: str | None
    review_status: str
    blocked_phrases: list[str]


class Rewriter:
    def __init__(
        self,
        provider: LlmProvider,
        scanner: ForbiddenPhraseScanner,
        *,
        model: str,
        temperature: float,
        template_version: str,
        prompt_template_id: str,
    ) -> None:
        self._provider = provider
        self._scanner = scanner
        self._model = model
        self._temperature = temperature
        self._template_version = template_version
        self._prompt_template_id = prompt_template_id

    def rewrite(self, approved_text: str) -> RewriteResult:
        """Reword approved prose. Returns pending-review text, or a rejection."""
        response = self._provider.complete(
            LlmRequest(
                system=_SYSTEM_PROMPT,
                user=approved_text,
                model=self._model,
                temperature=self._temperature,
            )
        )
        blocked = self._scanner.scan(response.text)
        status = REJECTED if blocked else PENDING_REVIEW
        log_generation(
            build_audit(
                model=response.model,
                template_version=self._template_version,
                prompt_template_id=self._prompt_template_id,
                structured_input=approved_text,
                response_text=response.text,
                review_status=status,
            )
        )
        if blocked:
            return RewriteResult(text=None, review_status=REJECTED, blocked_phrases=blocked)
        return RewriteResult(text=response.text, review_status=PENDING_REVIEW, blocked_phrases=[])
