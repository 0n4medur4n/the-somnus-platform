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

export const AssessmentContentResponseSchema = z
  .object({
    locale: LocaleSchema,
    workflowVersion: z.string().min(1),
    contentVersion: z.string().min(1),
    modules: z.array(AssessmentModuleContentSchema),
    safetyLevels: z.array(SafetyLevelContentSchema),
    outputContract: OutputContractContentSchema,
  })
  .strict();
export type AssessmentContentResponse = z.infer<typeof AssessmentContentResponseSchema>;
