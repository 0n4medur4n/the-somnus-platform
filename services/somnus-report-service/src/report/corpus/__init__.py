"""The reference corpus: an isolated module inside the report service (ADR 0010).

Addendum B Phase 16. Owns the `somnus_content` logical database (build plan §3.9)
— its own engine, its own Alembic history, its own declarative base — and is
reached only through `CorpusRepository`. Nothing here touches `somnus_reporting`,
and nothing in the report service reaches into these tables directly.

Why it lives in the report service rather than in a service of its own: §B3.1 has
report rendering merge Index A (`somnus_reporting`, the clinical sources) with
Index B (this corpus) at render time, and a service may not read another service's
database (§7 / ADR 0003). The reader owns it. The build plan's deployable map is
unchanged — five Cloud Run services, no additions (ADR 0010).
"""
