"""SQLAlchemy ORM models for the Morpheo reference tables (build plan §14).

These persist the versioned clinical reference data — the same content the
engine loads from the artifacts — so that assessment records can reference it
by foreign key (which safety rule fired, which module activated, which source
was cited) and so the schema is auditable. The rows are **seeded from the
artifacts** by a migration; nothing here restates clinical content by hand.

Stage A (Checkpoint 10.2) is the reference layer + gating; the transactional
tables (sessions, answers, claim tokens, snapshots, audit events) land in the
next stage.
"""

from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from morpheo.infrastructure.db import Base

# Opaque identifiers from the artifact (SAFE-001, INS, L0, CLM-001, SRC-01…)
# are short strings; free text (rule `when`, messages, citations) is TEXT.
_ID = String(64)


class WorkflowMeta(Base):
    """One row: the seeded artifact version stamped on every output (§14a)."""

    __tablename__ = "workflow_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    date: Mapped[str] = mapped_column(String(32), nullable=False)


class RoleDefinition(Base):
    __tablename__ = "role_definitions"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    eligibility: Mapped[str] = mapped_column(Text, nullable=False)
    output_language: Mapped[str] = mapped_column(String(255), nullable=False)

    age_bands: Mapped[list[AgeBand]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )


class AgeBand(Base):
    __tablename__ = "age_bands"
    __table_args__ = (UniqueConstraint("role_id", "band", name="uq_age_band"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role_id: Mapped[str] = mapped_column(_ID, ForeignKey("role_definitions.id"), nullable=False)
    band: Mapped[str] = mapped_column(String(32), nullable=False)

    role: Mapped[RoleDefinition] = relationship(back_populates="age_bands")


class SafetyLevel(Base):
    __tablename__ = "safety_levels"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    color: Mapped[str] = mapped_column(String(32), nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)


class SafetyRule(Base):
    __tablename__ = "safety_rules"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False)
    when_condition: Mapped[str] = mapped_column(Text, nullable=False)
    level_id: Mapped[str] = mapped_column(_ID, ForeignKey("safety_levels.id"), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    stop: Mapped[bool] = mapped_column(Boolean, nullable=False)


class ClinicalModule(Base):
    __tablename__ = "clinical_modules"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    entry_conditions: Mapped[list[ModuleEntryCondition]] = relationship(
        back_populates="module", cascade="all, delete-orphan"
    )


class ModuleEntryCondition(Base):
    __tablename__ = "module_entry_conditions"
    __table_args__ = (UniqueConstraint("module_id", "phrase", name="uq_module_entry"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    module_id: Mapped[str] = mapped_column(_ID, ForeignKey("clinical_modules.id"), nullable=False)
    phrase: Mapped[str] = mapped_column(String(255), nullable=False)

    module: Mapped[ClinicalModule] = relationship(back_populates="entry_conditions")


class ClinicalSource(Base):
    __tablename__ = "clinical_sources"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    citation: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    use: Mapped[str] = mapped_column(Text, nullable=False)


class ClaimRegistryEntry(Base):
    __tablename__ = "claims_registry"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    claim: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(String(255), nullable=False)
    channel: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str] = mapped_column(Text, nullable=False)
    replacement: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)


class CoreQuestion(Base):
    __tablename__ = "core_questions"

    id: Mapped[str] = mapped_column(_ID, primary_key=True)
    field: Mapped[str] = mapped_column(String(255), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    multi_select: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    allow_unknown: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ApprovedOutputTemplate(Base):
    __tablename__ = "approved_output_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    audience: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # patient_parent | professional
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    line: Mapped[str] = mapped_column(Text, nullable=False)


class ForbiddenPhrase(Base):
    __tablename__ = "forbidden_phrases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    phrase: Mapped[str] = mapped_column(Text, nullable=False)
