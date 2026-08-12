"""Morpheo pure rule engine (build plan §20 Checkpoint 10.1).

Zero I/O — no FastAPI, SQLAlchemy, Firebase, HTTP, LLM, or RAG (§14b). The engine
evaluates the loaded artifact's own rules over three-valued signals and returns
a deterministic result.
"""

from __future__ import annotations

from .boolean import (
    BooleanExpressionError,
    condition_atoms,
    evaluate_condition,
    parse_condition,
)
from .forbidden import (
    ForbiddenPattern,
    build_forbidden_patterns,
    scan_forbidden,
)
from .models import AssessmentInput, AssessmentResult
from .orchestrator import run_assessment
from .roles import Eligibility, evaluate_eligibility
from .routing import activate_modules, entry_vocabulary
from .safety import SafetyOutcome, run_safety_gate, urgency_rank
from .signals import Signals, Ternary, as_ternary
from .state_machine import (
    IllegalTransitionError,
    assert_legal_transition,
    is_legal_transition,
    legal_transitions,
)

__all__ = [
    "AssessmentInput",
    "AssessmentResult",
    "BooleanExpressionError",
    "Eligibility",
    "ForbiddenPattern",
    "IllegalTransitionError",
    "SafetyOutcome",
    "Signals",
    "Ternary",
    "activate_modules",
    "as_ternary",
    "assert_legal_transition",
    "build_forbidden_patterns",
    "condition_atoms",
    "entry_vocabulary",
    "evaluate_condition",
    "evaluate_eligibility",
    "is_legal_transition",
    "legal_transitions",
    "parse_condition",
    "run_assessment",
    "run_safety_gate",
    "scan_forbidden",
    "urgency_rank",
]
