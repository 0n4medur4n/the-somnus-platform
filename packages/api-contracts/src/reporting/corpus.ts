import { z } from "zod";
import { opaqueIdSchema } from "../uuid.js";

/**
 * The reference corpus on the wire (Addendum B §B3 / §B3.1, Checkpoint 16.3).
 *
 * The report service owns `somnus_content` through its isolated corpus module;
 * these are the shapes it puts on the wire and the admin console renders. The
 * Python mirror is `report.schemas.corpus`.
 *
 * Two things these shapes are deliberately unable to express, because §B3 and
 * §B3.1 forbid them and a screen is a weak place to enforce a rule:
 *
 * * **Deleting a document.** There is no delete request here and no route takes
 *   one. Retire is the only terminal action (§B3: append and retire).
 * * **Editing what the clinical artifact owns.** An SRC's identifier, citation,
 *   `use` and citing rules appear only in `SrcEnrichmentViewSchema`, which is a
 *   RESPONSE. No request in this file carries them, so there is nothing for a
 *   console route to write them with — the read-only rendering in the UI is a
 *   courtesy to the reader, not the guarantee.
 */

export const CORPUS_DOCUMENT_STATUSES = ["draft", "published", "retired"] as const;
export const CorpusDocumentStatusSchema = z.enum(CORPUS_DOCUMENT_STATUSES);
export type CorpusDocumentStatus = z.infer<typeof CorpusDocumentStatusSchema>;

/** §B4's four, mirrored from `report.corpus.rights`. */
export const CORPUS_RIGHTS_STATUSES = [
  "own_document",
  "open_access",
  "licensed",
  "citation_only",
] as const;
export const CorpusRightsStatusSchema = z.enum(CORPUS_RIGHTS_STATUSES);
export type CorpusRightsStatus = z.infer<typeof CorpusRightsStatusSchema>;

/**
 * Which statuses the console must warn about in plain language before publishing
 * (§B4). `licensed` and `citation_only` are the two where getting it wrong has a
 * cost outside the platform.
 */
export const CORPUS_RIGHTS_WARNING_STATUSES = ["licensed", "citation_only"] as const;

/** §B3's scope vocabulary. `general` exists, should be rare, and is flagged as such. */
export const CORPUS_SCOPE_TYPES = ["module", "safety_rule", "clinical_source", "general"] as const;
export const CorpusScopeTypeSchema = z.enum(CORPUS_SCOPE_TYPES);
export type CorpusScopeType = z.infer<typeof CorpusScopeTypeSchema>;

export const CorpusScopeSchema = z
  .object({
    scopeType: CorpusScopeTypeSchema,
    /** `INS`, `SAFE-006`, `SRC-05` — empty for `general`, which has no key. */
    scopeKey: z.string().max(64),
  })
  .strict();
export type CorpusScope = z.infer<typeof CorpusScopeSchema>;

/**
 * The evidence §B4 requires, by status: `licence` + `url` for open access,
 * `licence` + `holder` for licensed, nothing for the other two.
 *
 * Optional here and enforced in the report service, deliberately: §B4's gate is
 * one rule in one place (`report.corpus.rights.require_publishable`), used by both
 * the publish transition and the embedding boundary. A second copy of it in this
 * schema would be a second thing to keep in step, and the one that drifted would
 * be the one nobody tested.
 *
 * `.nullish()` rather than `.optional()`, here and throughout this file: the
 * provider is Pydantic, which serializes an unset optional as an explicit `null`
 * rather than omitting it. Declaring these absent-only would make this contract
 * reject the report service's own answers, which is exactly the drift the
 * generated JSON Schema and `tests/contract/test_corpus_contract.py` exist to
 * catch.
 */
export const CorpusRightsEvidenceSchema = z
  .object({
    licence: z.string().max(200).nullish(),
    url: z.string().max(500).nullish(),
    holder: z.string().max(200).nullish(),
  })
  .strict();
export type CorpusRightsEvidence = z.infer<typeof CorpusRightsEvidenceSchema>;

export const CorpusDocumentSchema = z
  .object({
    id: z.string().min(1).max(36),
    title: z.string().min(1).max(512),
    citation: z.string(),
    sourceType: z.string().max(64),
    locale: z.string().max(5),
    status: CorpusDocumentStatusSchema,
    rightsStatus: CorpusRightsStatusSchema.nullable(),
    rightsEvidence: CorpusRightsEvidenceSchema,
    addedBy: opaqueIdSchema,
    /** Null while a draft: a draft belongs to no corpus version. */
    corpusVersionAdded: z.number().int().positive().nullable(),
    corpusVersionRetired: z.number().int().positive().nullable(),
    retiredReason: z.string().nullable(),
    scopes: z.array(CorpusScopeSchema),
    chunkCount: z.number().int().nonnegative(),
  })
  .strict();
export type CorpusDocument = z.infer<typeof CorpusDocumentSchema>;

/**
 * One document with the text it currently holds (`GET /admin/v1/corpus/documents/:id`).
 *
 * The chunks come back only for a single document, never in a list: an edit screen
 * that could not show the text it is about to replace would invite an admin to
 * overwrite approved wording blind, and a list of every document's full text would
 * be a large payload for a screen that does not use it.
 */
export const CorpusDocumentDetailSchema = z
  .object({
    document: CorpusDocumentSchema,
    chunks: z.array(z.string()),
  })
  .strict();
export type CorpusDocumentDetail = z.infer<typeof CorpusDocumentDetailSchema>;

export const CorpusDocumentPageSchema = z
  .object({
    documents: z.array(CorpusDocumentSchema),
    currentVersion: z.number().int().nonnegative(),
  })
  .strict();
export type CorpusDocumentPage = z.infer<typeof CorpusDocumentPageSchema>;

/** `POST /admin/v1/corpus/documents` — create a draft. */
export const CorpusDocumentCreateRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(512),
    citation: z.string().trim().min(1).max(2000),
    sourceType: z.string().trim().min(1).max(64),
    locale: z.string().trim().min(2).max(5),
    rightsStatus: CorpusRightsStatusSchema.nullish(),
    rightsEvidence: CorpusRightsEvidenceSchema.nullish(),
    scopes: z.array(CorpusScopeSchema).min(1),
    /** The approved text. Chunked and capped per §B4 by the report service. */
    text: z.string().max(200_000).nullish(),
  })
  .strict();
export type CorpusDocumentCreateRequest = z.infer<typeof CorpusDocumentCreateRequestSchema>;

/** `POST /admin/v1/corpus/documents/:id/edit` — a draft's editable fields. */
export const CorpusDocumentEditRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(512).nullish(),
    citation: z.string().trim().min(1).max(2000).nullish(),
    sourceType: z.string().trim().min(1).max(64).nullish(),
    locale: z.string().trim().min(2).max(5).nullish(),
    rightsStatus: CorpusRightsStatusSchema.nullish(),
    rightsEvidence: CorpusRightsEvidenceSchema.nullish(),
    scopes: z.array(CorpusScopeSchema).min(1).nullish(),
    text: z.string().max(200_000).nullish(),
  })
  .strict();
export type CorpusDocumentEditRequest = z.infer<typeof CorpusDocumentEditRequestSchema>;

/** `POST /admin/v1/corpus/documents/:id/publish` — §B3's changelog is required. */
export const CorpusPublishRequestSchema = z
  .object({ changelog: z.string().trim().min(3).max(500) })
  .strict();
export type CorpusPublishRequest = z.infer<typeof CorpusPublishRequestSchema>;

/** `POST /admin/v1/corpus/documents/:id/retire` — the only terminal action. */
export const CorpusRetireRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    changelog: z.string().trim().min(3).max(500),
  })
  .strict();
export type CorpusRetireRequest = z.infer<typeof CorpusRetireRequestSchema>;

/** The result of a publish or retire: the version it created. */
export const CorpusVersionResultSchema = z
  .object({
    documentId: z.string().min(1).max(36),
    status: CorpusDocumentStatusSchema,
    corpusVersion: z.number().int().positive(),
  })
  .strict();
export type CorpusVersionResult = z.infer<typeof CorpusVersionResultSchema>;

/** `POST /admin/v1/corpus/documents/search` — list and search (§B5 16.3). */
export const CorpusSearchRequestSchema = z
  .object({
    query: z.string().trim().max(200).nullish(),
    status: CorpusDocumentStatusSchema.nullish(),
    locale: z.string().trim().min(2).max(5).nullish(),
    scopeType: CorpusScopeTypeSchema.nullish(),
    scopeKey: z.string().trim().max(64).nullish(),
    limit: z.number().int().min(1).max(200).nullish(),
  })
  .strict();
export type CorpusSearchRequest = z.infer<typeof CorpusSearchRequestSchema>;

// --- §B3.1: enriching a clinical source without touching the artifact ---------

/**
 * One of the fifteen SRC entries as the console shows it.
 *
 * Everything in `artifact` is owned by `morpheo_workflows_v1.json` and is
 * version-bound: it is what the deterministic engine stamps on a result. It
 * appears here so the console can render it, and appears in NO request shape at
 * all, so no console route can write it.
 *
 * `enrichments` are ordinary corpus documents scoped to this SRC. They are what
 * an admin may add, and they can only ever enrich the explanation — never change
 * which rule fired, which source it cited, or what that citation says.
 */
export const SrcArtifactFieldsSchema = z
  .object({
    id: z.string().regex(/^SRC-\d{2}$/),
    citation: z.string(),
    url: z.string(),
    use: z.string(),
    citedByRules: z.array(z.string()),
  })
  .strict();
export type SrcArtifactFields = z.infer<typeof SrcArtifactFieldsSchema>;

export const SrcEnrichmentViewSchema = z
  .object({
    artifact: SrcArtifactFieldsSchema,
    /** The `content_version` the artifact fields above came from. */
    contentVersion: z.string(),
    enrichments: z.array(CorpusDocumentSchema),
  })
  .strict();
export type SrcEnrichmentView = z.infer<typeof SrcEnrichmentViewSchema>;

export const SrcEnrichmentPageSchema = z
  .object({ sources: z.array(SrcEnrichmentViewSchema) })
  .strict();
export type SrcEnrichmentPage = z.infer<typeof SrcEnrichmentPageSchema>;

/**
 * The corpus boundary as cross-language JSON Schema (build plan §3.4 / §19).
 *
 * The report service is a Python provider, so it cannot ride NestJS's OpenAPI
 * generator; these are emitted to `schemas/json-schema/corpus/` and the Python
 * DTOs are validated against them in `tests/contract`. That is what keeps
 * `report.schemas.corpus` a mirror of this file rather than a second opinion.
 */
export const CORPUS_CONTRACT_SCHEMAS = {
  CorpusDocument: CorpusDocumentSchema,
  CorpusDocumentDetail: CorpusDocumentDetailSchema,
  CorpusDocumentPage: CorpusDocumentPageSchema,
  CorpusDocumentCreateRequest: CorpusDocumentCreateRequestSchema,
  CorpusDocumentEditRequest: CorpusDocumentEditRequestSchema,
  CorpusPublishRequest: CorpusPublishRequestSchema,
  CorpusRetireRequest: CorpusRetireRequestSchema,
  CorpusVersionResult: CorpusVersionResultSchema,
  CorpusSearchRequest: CorpusSearchRequestSchema,
  SrcEnrichmentPage: SrcEnrichmentPageSchema,
} as const;
