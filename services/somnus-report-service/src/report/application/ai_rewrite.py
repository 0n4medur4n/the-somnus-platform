"""The single gate for AI rewriting in the render pipeline (build plan §15).

AI rewriting is DISABLED by default (`AI_REWRITE_ENABLED` off, and unset counts as
off). It must stay off in every environment until a human-review mechanism for
`pending_review` content exists — none does today (Checkpoint 11.2): no endpoint,
admin UI, role, or persistence lets anyone approve or reject AI output.

`RenderService` consults this gate at the one point where AI rewriting could ever
enter the pipeline. With the flag off the pipeline is deterministic-only and the
Rewriter is never constructed or invoked. With the flag on there is still no
approval consumer, so serving unreviewed AI text is forbidden (§15) and the gate
raises rather than emit it. The absence of AI output is therefore structural, not
an accident of wiring: a Rewriter call added later without also flipping the flag
still produces nothing.
"""

from __future__ import annotations


class AiRewriteDisabledError(RuntimeError):
    """AI rewriting was reached while it is not permitted to serve output."""
