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

/** The named set exported as JSON Schema artifacts (schemas/json-schema/report). */
export const REPORT_CONTRACT_SCHEMAS = {
  ReportRenderRequest: ReportRenderRequestSchema,
  ReportRef: ReportRefSchema,
} as const;
