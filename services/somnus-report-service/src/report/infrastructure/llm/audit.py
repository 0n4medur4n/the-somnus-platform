"""Per-generation audit record (build plan §15).

Logs model id, template version, prompt-template id, a HASH of the structured
input and of the response, timestamp, and review status. It never carries raw
health text — only hashes — so the audit trail cannot leak clinical content.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

logger = logging.getLogger("report.llm.audit")


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class GenerationAudit:
    model: str
    template_version: str
    prompt_template_id: str
    input_hash: str
    response_hash: str
    review_status: str
    generated_at: str


def build_audit(
    *,
    model: str,
    template_version: str,
    prompt_template_id: str,
    structured_input: str,
    response_text: str,
    review_status: str,
) -> GenerationAudit:
    return GenerationAudit(
        model=model,
        template_version=template_version,
        prompt_template_id=prompt_template_id,
        input_hash=_sha256(structured_input),
        response_hash=_sha256(response_text),
        review_status=review_status,
        generated_at=datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
    )


def log_generation(audit: GenerationAudit) -> None:
    """Emits the §15 audit line (hashes only, never raw health text)."""
    logger.info("llm generation", extra={"llmAudit": asdict(audit)})
