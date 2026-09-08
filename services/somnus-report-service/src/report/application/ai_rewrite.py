"""The single gate for AI rewriting in the render pipeline (build plan §15).

AI rewriting is DISABLED by default (`AI_REWRITE_ENABLED` off, and unset counts as
off), and stays off in every environment until the clinical lead signs off after
having used the review queue. Checkpoint 15.3 built that queue
(`report.application.content_review`); building it is why the flag *can* be
turned on, not a reason that it should be.

`RenderService` consults this gate at the one point where AI rewriting could ever
enter the pipeline. With the flag off the pipeline is deterministic-only and the
Rewriter is never constructed or invoked. With the flag on, the only thing that
can make a candidate eligible is a human approval; absent one, serving the text
is forbidden (§15) and the gate raises rather than emit it. The absence of AI
output is therefore structural, not an accident of wiring: a Rewriter call added
later without also flipping the flag still produces nothing.

On the name, which reads backwards at first glance because the error fires while
the flag is *enabled*: it is named for the outcome, not the cause — AI rewriting
ends up disabled for this render. Until 15.3 the cause was "no review mechanism
exists at all"; it is now the narrower and more useful "no approved item exists
for this report", which is what the message says.
"""

from __future__ import annotations


class AiRewriteDisabledError(RuntimeError):
    """AI rewriting was reached while it is not permitted to serve output."""
