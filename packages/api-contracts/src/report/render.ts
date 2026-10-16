import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { ModuleIdSchema, RoleIdSchema, SafetyLevelIdSchema } from "../morpheo/enums.js";

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

/** The named set exported as JSON Schema artifacts (schemas/json-schema/report). */
export const REPORT_CONTRACT_SCHEMAS = {
  ReportRenderRequest: ReportRenderRequestSchema,
  ReportRef: ReportRefSchema,
  ReportPdf: ReportPdfSchema,
  PersonReportResponse: PersonReportResponseSchema,
} as const;
