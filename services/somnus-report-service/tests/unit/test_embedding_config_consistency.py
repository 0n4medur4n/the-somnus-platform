"""Index A and Index B embed from one configuration (§3.6b / Addendum B §B2a).

There are two vector indexes in this service — the fifteen clinical sources in
`somnus_reporting` (Checkpoint 11.3 / 16.0) and the reference corpus in
`somnus_content` (Checkpoint 16.4) — written by two different code paths at two
different moments. Both are ranked by cosine against a query vector built in the
same process, so each index's stored vectors and the queries put to it must come
from the same model at the same dimensionality.

Nothing about that is enforced by a type. It is enforced by every construction
site threading the same two `Settings` fields, and this test is what says so.

**What a divergence would actually cost.** The two indexes are never compared
with each other, so a mismatch would not scramble one against the other — it
would silently degrade ranking *within* whichever path changed, because its
stored vectors and its queries would no longer share a space. Cosine still
returns a number, the report still renders, and nothing fails. That is precisely
why this is a test and not an assertion at runtime: the failure has no symptom.

The three ways the two could drift apart, and how each is caught here:

1. A literal at a call site (`model="text-embedding-3-small"`, `dimensions=1024`)
   — the kwarg check below refuses anything that is not the settings attribute.
2. A second pair of settings fields (`corpus_embedding_model`, say) wired into
   one path only — the single-source check refuses a second field.
3. A site added later that reaches for a provider with its own configuration —
   the kwarg check covers every call in both wiring files, not a fixed list.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from report.settings.config import Settings

SERVICE = Path(__file__).resolve().parents[2]

#: The two files that wire an embedding path. Index B's is the app factory; Index
#: A's is the batch job, which never runs on the boot path (§B2a.1).
WIRING_FILES = {
    "index_b": SERVICE / "src" / "report" / "main.py",
    "index_a": SERVICE / "src" / "report" / "jobs" / "index_sources.py",
}

#: What every embedding call site must pass, and the only thing it may pass.
EXPECTED_SOURCE = {
    "model": "settings.embedding_model",
    "dimensions": "settings.embedding_dimensions",
}


def _embedding_arguments(path: Path) -> list[tuple[str, str, str, int]]:
    """Every `model=` / `dimensions=` argument in a file, as (callee, arg, source, line)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[tuple[str, str, str, int]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        callee = getattr(node.func, "id", None) or getattr(node.func, "attr", "") or "?"
        for keyword in node.keywords:
            if keyword.arg in EXPECTED_SOURCE:
                found.append(
                    (callee, keyword.arg, ast.unparse(keyword.value), keyword.value.lineno)
                )
    return found


@pytest.mark.parametrize("index", sorted(WIRING_FILES))
def test_every_embedding_call_site_reads_the_shared_settings(index: str) -> None:
    """One configuration, threaded — never a literal, never a second field."""
    arguments = _embedding_arguments(WIRING_FILES[index])
    assert arguments, f"{WIRING_FILES[index].name} wires no embedding path any more"

    for callee, argument, source, line in arguments:
        assert source == EXPECTED_SOURCE[argument], (
            f"{WIRING_FILES[index].name}:{line} passes {callee}({argument}={source}); "
            f"it must be {EXPECTED_SOURCE[argument]}, so Index A and Index B cannot "
            "drift into embedding at different models or dimensionalities"
        )


def test_both_indexes_are_actually_covered_by_the_check_above() -> None:
    """Guards against the scan passing because it found nothing to look at.

    Named by their constructors rather than by a count: a fifth call site is a
    normal thing to add, and the check above already governs it. A *missing*
    indexer is not normal — it means this test is watching the wrong file.
    """
    index_a = {callee for callee, _, _, _ in _embedding_arguments(WIRING_FILES["index_a"])}
    index_b = {callee for callee, _, _, _ in _embedding_arguments(WIRING_FILES["index_b"])}

    assert "SourceIndexer" in index_a, "Index A's indexer is no longer wired here"
    assert "CorpusIndexer" in index_b, "Index B's indexer is no longer wired here"
    # Both rankers too: a query embedded at a different model than the index it
    # is ranked against is the same failure, one step later.
    assert "VectorStoreRetriever" in index_b
    assert "CorpusRetriever" in index_b


def test_the_service_has_exactly_one_embedding_model_and_one_dimension_field() -> None:
    """The single source, checked as a single source.

    A `corpus_embedding_model` added beside `embedding_model` would let the two
    paths be configured apart without any call site looking wrong.
    """
    fields = set(Settings.model_fields)

    assert {name for name in fields if "embedding" in name and "model" in name} == {
        "embedding_model"
    }
    assert {name for name in fields if "embedding" in name and "dimension" in name} == {
        "embedding_dimensions"
    }
