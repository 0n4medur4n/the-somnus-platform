"""Versions stamped on every Morpheo output (build plan §14 / §14a).

The artifact carries a single `meta.version`; both `WORKFLOW_VERSION` and
`CONTENT_VERSION` bind to it. Importing this module validates the committed
artifacts (via the cached loader), so a broken spec fails loudly here rather
than mid-assessment.
"""

from __future__ import annotations

from .loader import clinical_bundle

WORKFLOW_VERSION: str = clinical_bundle().workflow_version
CONTENT_VERSION: str = clinical_bundle().content_version
