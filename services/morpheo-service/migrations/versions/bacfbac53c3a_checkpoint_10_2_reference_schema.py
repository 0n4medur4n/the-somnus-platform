"""Checkpoint 10.2 reference schema + seeding from the artifacts.

Creates the §14 reference tables and seeds them **from the committed clinical
artifacts** (build plan §14a: code loads and enforces, never restates). The
seed reads morpheo_workflows_v1.json and morpheo_claims_registry_v1.csv
directly, so the migration is self-contained and the DB reflects exactly the
versioned source of truth. downgrade drops the tables (and their data).

Revision ID: bacfbac53c3a
Revises: 977397ed9537
Create Date: 2026-08-13 16:01:18.039619
"""

from __future__ import annotations

import csv
import json
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "bacfbac53c3a"
down_revision: str | Sequence[str] | None = "977397ed9537"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# services/morpheo-service/migrations/versions/<rev>.py -> <service root>/clinical
CLINICAL_DIR = Path(__file__).resolve().parents[2] / "clinical"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "approved_output_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("audience", sa.String(length=32), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("line", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "claims_registry",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("claim", sa.Text(), nullable=False),
        sa.Column("audience", sa.String(length=255), nullable=False),
        sa.Column("channel", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False),
        sa.Column("replacement", sa.Text(), nullable=False),
        sa.Column("owner", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "clinical_modules",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "clinical_sources",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("citation", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("use", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "core_questions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("field", sa.String(length=255), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("multi_select", sa.Boolean(), nullable=False),
        sa.Column("allow_unknown", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "forbidden_phrases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("phrase", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "role_definitions",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("eligibility", sa.Text(), nullable=False),
        sa.Column("output_language", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "safety_levels",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("color", sa.String(length=32), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "workflow_meta",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("date", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "age_bands",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("role_id", sa.String(length=64), nullable=False),
        sa.Column("band", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["role_id"], ["role_definitions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role_id", "band", name="uq_age_band"),
    )
    op.create_table(
        "module_entry_conditions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("module_id", sa.String(length=64), nullable=False),
        sa.Column("phrase", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(["module_id"], ["clinical_modules.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("module_id", "phrase", name="uq_module_entry"),
    )
    op.create_table(
        "safety_rules",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("when_condition", sa.Text(), nullable=False),
        sa.Column("level_id", sa.String(length=64), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("stop", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["level_id"], ["safety_levels.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    _seed_from_artifacts()


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("safety_rules")
    op.drop_table("module_entry_conditions")
    op.drop_table("age_bands")
    op.drop_table("workflow_meta")
    op.drop_table("safety_levels")
    op.drop_table("role_definitions")
    op.drop_table("forbidden_phrases")
    op.drop_table("core_questions")
    op.drop_table("clinical_sources")
    op.drop_table("clinical_modules")
    op.drop_table("claims_registry")
    op.drop_table("approved_output_templates")


def _seed_from_artifacts() -> None:
    data = json.loads((CLINICAL_DIR / "morpheo_workflows_v1.json").read_text(encoding="utf-8"))

    op.bulk_insert(
        sa.table(
            "workflow_meta",
            sa.column("id", sa.Integer),
            sa.column("version", sa.String),
            sa.column("date", sa.String),
        ),
        [{"id": 1, "version": data["meta"]["version"], "date": data["meta"]["date"]}],
    )

    op.bulk_insert(
        sa.table(
            "role_definitions",
            sa.column("id", sa.String),
            sa.column("label", sa.String),
            sa.column("eligibility", sa.Text),
            sa.column("output_language", sa.String),
        ),
        [
            {
                "id": role["id"],
                "label": role["label"],
                "eligibility": role["eligibility"],
                "output_language": role["output_language"],
            }
            for role in data["roles"]
        ],
    )

    age_bands = [
        {"role_id": role["id"], "band": band}
        for role in data["roles"]
        for band in role.get("age_bands") or []
    ]
    if age_bands:
        op.bulk_insert(
            sa.table("age_bands", sa.column("role_id", sa.String), sa.column("band", sa.String)),
            age_bands,
        )

    op.bulk_insert(
        sa.table(
            "safety_levels",
            sa.column("id", sa.String),
            sa.column("name", sa.String),
            sa.column("color", sa.String),
            sa.column("action", sa.Text),
        ),
        [
            {"id": lv["id"], "name": lv["name"], "color": lv["color"], "action": lv["action"]}
            for lv in data["safety_levels"]
        ],
    )

    op.bulk_insert(
        sa.table(
            "safety_rules",
            sa.column("id", sa.String),
            sa.column("priority", sa.Integer),
            sa.column("when_condition", sa.Text),
            sa.column("level_id", sa.String),
            sa.column("message", sa.Text),
            sa.column("stop", sa.Boolean),
        ),
        [
            {
                "id": rule["id"],
                "priority": rule["priority"],
                "when_condition": rule["when"],
                "level_id": rule["level"],
                "message": rule["message"],
                "stop": rule["stop"],
            }
            for rule in data["safety_rules"]
        ],
    )

    op.bulk_insert(
        sa.table("clinical_modules", sa.column("id", sa.String), sa.column("name", sa.String)),
        [{"id": module["id"], "name": module["name"]} for module in data["modules"]],
    )
    op.bulk_insert(
        sa.table(
            "module_entry_conditions",
            sa.column("module_id", sa.String),
            sa.column("phrase", sa.String),
        ),
        [
            {"module_id": module["id"], "phrase": phrase}
            for module in data["modules"]
            for phrase in module["entry"]
        ],
    )

    op.bulk_insert(
        sa.table(
            "clinical_sources",
            sa.column("id", sa.String),
            sa.column("citation", sa.Text),
            sa.column("url", sa.Text),
            sa.column("use", sa.Text),
        ),
        [
            {"id": s["id"], "citation": s["citation"], "url": s["url"], "use": s["use"]}
            for s in data["sources"]
        ],
    )

    op.bulk_insert(
        sa.table(
            "core_questions",
            sa.column("id", sa.String),
            sa.column("field", sa.String),
            sa.column("required", sa.Boolean),
            sa.column("multi_select", sa.Boolean),
            sa.column("allow_unknown", sa.Boolean),
        ),
        [
            {
                "id": q["id"],
                "field": q["field"],
                "required": q["required"],
                "multi_select": bool(q.get("multi_select")),
                "allow_unknown": bool(q.get("allow_unknown")),
            }
            for q in data["core_questions"]
        ],
    )

    contract = data["output_contract"]
    op.bulk_insert(
        sa.table(
            "approved_output_templates",
            sa.column("audience", sa.String),
            sa.column("ordinal", sa.Integer),
            sa.column("line", sa.Text),
        ),
        [
            {"audience": audience, "ordinal": ordinal, "line": line}
            for audience in ("patient_parent", "professional")
            for ordinal, line in enumerate(contract[audience])
        ],
    )
    op.bulk_insert(
        sa.table("forbidden_phrases", sa.column("phrase", sa.Text)),
        [{"phrase": phrase} for phrase in contract["forbidden_phrases"]],
    )

    with (CLINICAL_DIR / "morpheo_claims_registry_v1.csv").open(
        encoding="utf-8-sig", newline=""
    ) as handle:
        claims = list(csv.DictReader(handle))
    op.bulk_insert(
        sa.table(
            "claims_registry",
            sa.column("id", sa.String),
            sa.column("claim", sa.Text),
            sa.column("audience", sa.String),
            sa.column("channel", sa.String),
            sa.column("status", sa.String),
            sa.column("reason", sa.Text),
            sa.column("evidence", sa.Text),
            sa.column("replacement", sa.Text),
            sa.column("owner", sa.String),
        ),
        [
            {
                "id": row["id"],
                "claim": row["claim"],
                "audience": row["audience"],
                "channel": row["channel"],
                "status": row["status"],
                "reason": row["reason"],
                "evidence": row["evidence"],
                "replacement": row["replacement"],
                "owner": row["owner"],
            }
            for row in claims
        ],
    )
