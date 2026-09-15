"""The indexing job's entry point (Checkpoint 16.0 / Addendum B §B2a.1).

Two properties, both about WHEN indexing happens rather than how.

**Never on boot.** Minimum instances are zero everywhere, so the service boots on
every cold start; indexing there would call the OpenAI API constantly and make the
index depend on which instance started first. This is asserted structurally — by
walking the imports of everything that runs when the service starts — rather than
by starting the app and watching for a call, which would only prove that one
particular startup path happened not to reach the indexer today.

**A key is needed only when something needs embedding**, and a run that needs one
and lacks it fails before any write.
"""

from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import pytest

from report.infrastructure.llm.openai_embedding_adapter import OpenAiEmbeddingAdapter
from report.infrastructure.llm.provider import EmbeddingRequest
from report.jobs.index_sources import (
    EmbeddingNotConfiguredError,
    UnconfiguredEmbedder,
    build_embedder,
)
from report.settings.config import Settings

SERVICE = Path(__file__).resolve().parents[2]
PACKAGE = SERVICE / "src" / "report"

# Anything that pulls these in can start indexing.
INDEXING_MODULES = ("report.jobs", "report.application.source_indexer")


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            found.add(node.module)
    return found


def _boot_path_files() -> list[Path]:
    """What runs when the container starts: the app module and every HTTP route."""
    return [PACKAGE / "main.py", *sorted((PACKAGE / "api").rglob("*.py"))]


def test_the_boot_path_is_the_one_the_container_actually_runs() -> None:
    # If the image ever started something other than report.main, the structural
    # test below would be checking the wrong files.
    dockerfile = (SERVICE / "Dockerfile").read_text(encoding="utf-8")
    assert 'CMD ["python", "-m", "report.main"]' in dockerfile
    assert "index_sources" not in dockerfile
    assert len(_boot_path_files()) > 1


@pytest.mark.parametrize("path", _boot_path_files(), ids=lambda path: path.name)
def test_nothing_on_the_boot_path_imports_the_indexer(path: Path) -> None:
    offenders = {
        name
        for name in _imports(path)
        if any(name == module or name.startswith(f"{module}.") for module in INDEXING_MODULES)
    }
    assert offenders == set(), f"{path.name} imports {offenders}: indexing must never run on boot"


def test_starting_the_service_does_not_even_load_the_indexer() -> None:
    """The transitive version of the check above.

    A direct-imports scan cannot see `main -> repository -> indexer`, and that
    chain existed while this checkpoint was being written. So import the app the
    way the container does, in a fresh interpreter, and look at what got loaded.
    """
    probe = (
        "import json, sys; import report.main; "
        "print(json.dumps(sorted(m for m in sys.modules if m.startswith('report.'))))"
    )
    completed = subprocess.run(
        [sys.executable, "-c", probe],
        cwd=SERVICE,
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )
    loaded = json.loads(completed.stdout.strip().splitlines()[-1])
    assert "report.main" in loaded
    leaked = [
        name
        for name in loaded
        if any(name == module or name.startswith(f"{module}.") for module in INDEXING_MODULES)
    ]
    assert leaked == []


def test_the_service_never_constructs_an_indexer_by_name() -> None:
    # Belt and braces against a lazy import inside a function body.
    for path in _boot_path_files():
        assert "SourceIndexer" not in path.read_text(encoding="utf-8"), path.name


def test_without_a_key_the_embedder_refuses_only_when_asked_to_embed() -> None:
    embedder = build_embedder(Settings(OPENAI_API_KEY=""))
    assert isinstance(embedder, UnconfiguredEmbedder)

    texts = ["APPROVED-TEXT-ONE", "APPROVED-TEXT-TWO"]
    with pytest.raises(EmbeddingNotConfiguredError, match="2 clinical source") as error:
        embedder.embed(EmbeddingRequest(inputs=texts, model="m", dimensions=4))
    # The message names a count, never the text it was asked to embed.
    assert not any(text in str(error.value) for text in texts)


def test_with_a_key_the_real_adapter_is_used() -> None:
    assert isinstance(build_embedder(Settings(OPENAI_API_KEY="sk-test")), OpenAiEmbeddingAdapter)
