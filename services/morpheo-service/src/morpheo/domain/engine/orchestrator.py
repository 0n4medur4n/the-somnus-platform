"""The deterministic assessment, wiring the pure steps of §14a together.

    role   = require_role_and_eligibility(inputs)
    safety = run_safety_gate(all_known_answers)     # 9 rules, priority-ordered
    if safety.stop: escalate(safety)                # approved message, no reassurance
    routes = activate_all_matching_modules(profile) # INS/BRE/SLP/CIR/RLS/PAR, multi-label
    level  = safety level, else the profile's non-urgent orientation (L3/L4)

Given a complete set of answers the result is a pure function of the inputs and
the loaded artifact — the same answers always yield the same level and routes
(§14b). The interactive state machine (incremental answers, re-evaluation) is
Checkpoint 10.2; here the engine computes the deterministic outcome.
"""

from __future__ import annotations

from morpheo.clinical.loader import ClinicalBundle

from .models import AssessmentInput, AssessmentResult
from .roles import evaluate_eligibility
from .routing import activate_modules
from .safety import SafetyOutcome, run_safety_gate
from .signals import Signals

_NO_SAFETY = SafetyOutcome(level=None, stop=False, triggered_rule_ids=(), message=None)


def run_assessment(inp: AssessmentInput, bundle: ClinicalBundle) -> AssessmentResult:
    workflows = bundle.workflows
    version = workflows.meta.version

    eligibility = evaluate_eligibility(inp)
    if not eligibility.eligible or eligibility.privacy_block:
        # Ineligible, or a professional privacy block (T-12): nothing is processed.
        return AssessmentResult(
            role=inp.role,
            eligible=eligibility.eligible,
            privacy_block=eligibility.privacy_block,
            routes=frozenset(),
            safety=_NO_SAFETY,
            level=None,
            stop=False,
            triggered_rule_ids=(),
            workflow_version=version,
            content_version=version,
        )

    signals = Signals.from_answers(inp.safety_answers)
    safety = run_safety_gate(workflows.safety_rules, signals)
    routes = activate_modules(workflows.modules, inp.complaints)

    if safety.fired:
        level = safety.level
        stop = safety.stop
    else:
        level = inp.base_orientation
        stop = False

    return AssessmentResult(
        role=inp.role,
        eligible=True,
        privacy_block=False,
        routes=routes,
        safety=safety,
        level=level,
        stop=stop,
        triggered_rule_ids=safety.triggered_rule_ids,
        workflow_version=version,
        content_version=version,
    )
