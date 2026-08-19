"""Mapping Morpheo's clinical-source corpus to the report DTOs (build plan §3.6b)."""

from __future__ import annotations

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
            },
            {
                "id": "SRC-02",
                "citation": "Kapur VK, et al. Diagnostic Testing for Adult OSA.",
                "url": "https://example.org/src-02",
                "use": "Sospecha de AOS.",
            },
        ],
    }
    corpus = _to_sources(raw)

    assert corpus.content_version == "1.3"
    assert [source.id for source in corpus.sources] == ["SRC-01", "SRC-02"]
    assert corpus.sources[0].citation.startswith("Riemann")
    assert corpus.sources[1].use == "Sospecha de AOS."
