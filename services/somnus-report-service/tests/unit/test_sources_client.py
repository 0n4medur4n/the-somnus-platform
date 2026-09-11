"""Mapping Morpheo's clinical-source corpus to the report DTOs (build plan §3.6b)."""

from __future__ import annotations

import pytest

from report.infrastructure.sources_client import _to_sources


def test_maps_morpheo_clinical_sources() -> None:
    raw = {
        "contentVersion": "1.3",
        "sources": [
            {
                "id": "SRC-01",
                "citation": "Riemann D, et al. European Insomnia Guideline 2023.",
                "url": "https://example.org/src-01",
                "use": "Anamnesis y cronicidad del insomnio.",
                "citedByRules": ["SAFE-006", "SAFE-001"],
            },
            {
                "id": "SRC-02",
                "citation": "Kapur VK, et al. Diagnostic Testing for Adult OSA.",
                "url": "https://example.org/src-02",
                "use": "Sospecha de AOS.",
                "citedByRules": [],
            },
        ],
    }
    corpus = _to_sources(raw)

    assert corpus.content_version == "1.3"
    assert [source.id for source in corpus.sources] == ["SRC-01", "SRC-02"]
    assert corpus.sources[0].citation.startswith("Riemann")
    assert corpus.sources[1].use == "Sospecha de AOS."
    # The rule mapping is what the by-id citation path resolves on, so it has to
    # survive the mapping intact and in order (Checkpoint 11.3 Stage 4).
    assert corpus.sources[0].cited_by_rules == ("SAFE-006", "SAFE-001")
    assert corpus.sources[1].cited_by_rules == ()


def test_a_morpheo_without_the_rule_mapping_fails_loudly() -> None:
    """A morpheo that predates the contract must not index silently.

    Falling back to an empty mapping would look like success and quietly put
    every report back on the similarity path -- the exact defect Stage 4 closes,
    reintroduced by a deploy-order mistake nobody would see.
    """
    raw = {
        "contentVersion": "1.3",
        "sources": [
            {"id": "SRC-01", "citation": "c", "url": "u", "use": "x"},
        ],
    }
    with pytest.raises(KeyError):
        _to_sources(raw)
