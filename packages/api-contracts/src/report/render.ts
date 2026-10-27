import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { ModuleIdSchema, RoleIdSchema, SafetyLevelIdSchema } from "../morpheo/enums.js";
import { FunnelInstrumentSchema, FunnelReportSchema, FunnelTextSchema } from "../morpheo/funnel.js";

/**
 * The report service boundary (build plan §5.6 / §20 Checkpoint 11.1). The
 * report renders an ALREADY-COMPUTED Morpheo result into a versioned, localized
 * document; it never recalculates scores, alters safety flags, or invents
 * clinical facts. The clinical wording is Morpheo's approved content — the
 * report only lays it out.
 */

/**
 * edge/worker -> report: render request. Carries the deterministic result the
 * report lays out (the build plan's safetyFlags + orientationCodes), plus the
 * versions stamped on the output and the locale to render in.
 */
export const ReportRenderRequestSchema = z
  .object({
    assessmentId: z.string().min(1),
    // Morpheo workflow_version (the rule/spec version) and content_version.
    definitionVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    locale: LocaleSchema,
    role: RoleIdSchema,
    // safetyFlags: the fired safety outcome (never recomputed here).
    level: SafetyLevelIdSchema.nullable(),
    stop: z.boolean(),
    triggeredRules: z.array(z.string().min(1)),
    // orientationCodes: the activated clinical modules.
    routes: z.array(ModuleIdSchema),
    completedAt: z.string().min(1),
  })
  .strict();
export type ReportRenderRequest = z.infer<typeof ReportRenderRequestSchema>;

/**
 * report -> edge: an immutable reference to a rendered report. The signed URLs
 * are short-lived and served through the edge (§9); they are null until the
 * render+store step exists.
 */
export const ReportRefSchema = z
  .object({
    reportId: z.string().min(1),
    assessmentId: z.string().min(1),
    templateVersion: z.string().min(1),
    definitionVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    locale: LocaleSchema,
    createdAt: z.string().min(1),
    htmlUrl: z.string().min(1).nullable(),
    pdfUrl: z.string().min(1).nullable(),
  })
  .strict();
export type ReportRef = z.infer<typeof ReportRefSchema>;

/**
 * report -> edge: one report as a PDF, rendered on demand and not stored
 * (the person's own "download my report"). Base64: the internal client speaks
 * JSON. edge decodes it and hands over the file; nothing is kept.
 */
export const ReportPdfSchema = z
  .object({
    assessmentId: z.string().min(1),
    templateVersion: z.string().min(1),
    definitionVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    locale: LocaleSchema,
    createdAt: z.string().min(1),
    pdfBase64: z.string().min(1),
  })
  .strict();
export type ReportPdf = z.infer<typeof ReportPdfSchema>;

/**
 * The person's report, written by the AI from their structured result (build
 * plan §15 amended 2026-10-16: live, not reviewed). Bounded on both sides; the
 * level and the urgent instructions are NOT in it -- they stay the protocol's
 * own words, printed apart.
 */
export const PersonReportSchema = z
  .object({
    summary: z.string().min(1).max(900),
    whatToDo: z.array(z.string().min(1)).min(1).max(4),
    patterns: z
      .array(
        z.object({ name: z.string().min(1).max(120), why: z.string().min(1).max(600) }).strict(),
      )
      .max(3),
    recommendations: z.array(z.string().min(1)).max(6),
    prepare: z.array(z.string().min(1)).max(8),
  })
  .strict();
export type PersonReport = z.infer<typeof PersonReportSchema>;

/**
 * report -> edge -> app. `generated: false` (an emergency, which never reaches a
 * model, or a failed/refused generation): the app shows the protocol's wording.
 */
export const PersonReportResponseSchema = z
  .object({
    assessmentId: z.string().min(1),
    locale: LocaleSchema,
    generated: z.boolean(),
    narrative: PersonReportSchema.nullish(),
  })
  .strict();
export type PersonReportResponse = z.infer<typeof PersonReportResponseSchema>;

/**
 * edge -> report: erase the stored person's reports of these assessments (the
 * right to erasure, build plan §21). The report service keys them by assessment
 * id only, so the edge -- which knows whose assessments they are -- names them.
 */
export const PersonReportsDeleteRequestSchema = z
  .object({
    assessmentIds: z.array(z.string().min(1).max(64)).max(1000),
  })
  .strict();
export type PersonReportsDeleteRequest = z.infer<typeof PersonReportsDeleteRequestSchema>;

/** report -> edge: how many stored reports (all languages) were erased. */
export const PersonReportsDeleteResultSchema = z
  .object({
    deleted: z.number().int().min(0),
  })
  .strict();
export type PersonReportsDeleteResult = z.infer<typeof PersonReportsDeleteResultSchema>;

/**
 * edge -> report: the v2 report (embudo v0.2) as a PDF, on demand, not stored.
 * Deterministic: it lays out morpheo's final text paragraph by paragraph --
 * written only from the v0.2 templates and the approved phrase catalogue --
 * and the completed instrument scores. No model writes or rewrites any of it.
 */
export const FunnelReportRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    locale: LocaleSchema,
    completedAt: z.string().min(1),
    contentVersion: z.string().min(1),
    rulesVersion: z.string().min(1),
    texts: z.array(FunnelTextSchema).min(1),
    instruments: z.array(FunnelInstrumentSchema),
    instrumentsNote: z.string().nullable(),
    // The one-page report and the professional's page (REPORT_V3); absent: the v2 layout.
    report: FunnelReportSchema.nullable().optional(),
  })
  .strict();
export type FunnelReportRequest = z.infer<typeof FunnelReportRequestSchema>;

/** The named set exported as JSON Schema artifacts (schemas/json-schema/report). */
export const REPORT_CONTRACT_SCHEMAS = {
  ReportRenderRequest: ReportRenderRequestSchema,
  ReportRef: ReportRefSchema,
  ReportPdf: ReportPdfSchema,
  PersonReportResponse: PersonReportResponseSchema,
  PersonReportsDeleteRequest: PersonReportsDeleteRequestSchema,
  PersonReportsDeleteResult: PersonReportsDeleteResultSchema,
  FunnelReportRequest: FunnelReportRequestSchema,
} as const;
