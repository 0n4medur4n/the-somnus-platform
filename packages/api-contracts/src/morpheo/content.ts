import { z } from "zod";
import { LocaleSchema } from "../locale.js";
import { ModuleIdSchema, SafetyLevelIdSchema } from "./enums.js";

/**
 * The localized assessment display content (build plan §20 Checkpoint 10.3,
 * "localized questions and approved output wording per locale"; §14a: the
 * versioned artifacts are the source of truth). Morpheo serves this from the
 * clinical artifacts so the SPA renders approved wording rather than restating
 * clinical content. Only `es` exists today; other locales follow when their
 * artifacts land.
 */

export const AssessmentModuleContentSchema = z
  .object({
    id: ModuleIdSchema,
    name: z.string().min(1),
    entry: z.array(z.string().min(1)),
    minimumQuestions: z.array(z.string().min(1)),
    output: z.string().min(1),
  })
  .strict();
export type AssessmentModuleContent = z.infer<typeof AssessmentModuleContentSchema>;

export const SafetyLevelContentSchema = z
  .object({
    id: SafetyLevelIdSchema,
    name: z.string().min(1),
    action: z.string().min(1),
  })
  .strict();
export type SafetyLevelContent = z.infer<typeof SafetyLevelContentSchema>;

export const OutputContractContentSchema = z
  .object({
    patientParent: z.array(z.string().min(1)),
    professional: z.array(z.string().min(1)),
    forbiddenPhrases: z.array(z.string().min(1)),
  })
  .strict();
export type OutputContractContent = z.infer<typeof OutputContractContentSchema>;

/** Where a safety question is shown; `pediatric` = parent/guardian role only. */
export const SAFETY_PROMPT_CONTEXTS = ["general", "pediatric"] as const;
export const SafetyPromptContextSchema = z.enum(SAFETY_PROMPT_CONTEXTS);
export type SafetyPromptContext = z.infer<typeof SafetyPromptContextSchema>;

/**
 * The clinically-approved question text for one safety-signal atom. Answered
 * Sí / No / No lo sé; "No lo sé" maps to unknown, never false (§14 unknown
 * policy). Approved wording — the client renders it verbatim.
 */
export const SafetyPromptContentSchema = z
  .object({
    signalId: z.string().min(1),
    context: SafetyPromptContextSchema,
    question: z.string().min(1),
  })
  .strict();
export type SafetyPromptContent = z.infer<typeof SafetyPromptContentSchema>;

export const AssessmentContentResponseSchema = z
  .object({
    locale: LocaleSchema,
    workflowVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    modules: z.array(AssessmentModuleContentSchema),
    safetyLevels: z.array(SafetyLevelContentSchema),
    safetyPrompts: z.array(SafetyPromptContentSchema),
    // The governed limits statements (build plan §14b), sourced verbatim from
    // the approved CLM-006/007/008 replacement text — three separate sentences,
    // never merged. es-only; the single source consumers (report) lay out.
    limitsText: z.array(z.string().min(1)),
    outputContract: OutputContractContentSchema,
  })
  .strict();
export type AssessmentContentResponse = z.infer<typeof AssessmentContentResponseSchema>;
