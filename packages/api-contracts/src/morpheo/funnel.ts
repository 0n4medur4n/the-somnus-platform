import { z } from "zod";
import { FREE_TEXT_MAX_LENGTH, findIdentifyingData } from "./identifying-data.js";

/**
 * The Morpheo v2 interview (the embudo v0.2, ADR 0020) across edge <-> morpheo
 * and app <-> edge. The engine decides every step: the app only shows the step
 * it is given and sends back the answer to that step. Order, branches, rules,
 * the safety exceptions and the final text all live in morpheo.
 *
 * The final text comes only from the v0.2 templates and the approved phrase
 * catalogue -- no model writes any of it. `panel` (why a step was asked, the
 * branches, rules and phrases behind it) is for the team only: the edge strips
 * it for anyone without an internal role.
 */

/** "No lo sé" and "Prefiero no responder" (R03: unknown is never "No"). */
export const FUNNEL_ABSENCES = ["no_lo_se", "prefiero_no_responder"] as const;
export const FunnelAbsenceSchema = z.enum(FUNNEL_ABSENCES);
export type FunnelAbsence = z.infer<typeof FunnelAbsenceSchema>;

export const FUNNEL_STEP_KINDS = ["ask", "confirm", "info", "instrument_intro"] as const;
export const FunnelStepKindSchema = z.enum(FUNNEL_STEP_KINDS);
export type FunnelStepKind = z.infer<typeof FunnelStepKindSchema>;

export const FUNNEL_ANSWER_TYPES = [
  "number",
  "yes_no",
  "yes_no_note",
  "free_text",
  "duration",
  "times",
  "multi",
  "single",
  "info",
  "instrument_intro",
] as const;
export const FunnelAnswerTypeSchema = z.enum(FUNNEL_ANSWER_TYPES);
export type FunnelAnswerType = z.infer<typeof FunnelAnswerTypeSchema>;

/** Where in the interview a step is, for the progress indicator. */
export const FUNNEL_PHASES = [
  "start",
  "story",
  "branches",
  "instrument",
  "protection",
  "closing",
] as const;
export const FunnelPhaseSchema = z.enum(FUNNEL_PHASES);
export type FunnelPhase = z.infer<typeof FunnelPhaseSchema>;

export const FUNNEL_STATUSES = ["open", "finished", "stopped", "paused"] as const;
export const FunnelStatusSchema = z.enum(FUNNEL_STATUSES);
export type FunnelStatus = z.infer<typeof FunnelStatusSchema>;

export const FUNNEL_INSTRUMENT_STATUSES = [
  "completed",
  "declined",
  "incomplete",
  "pending_file",
] as const;
export const FunnelInstrumentStatusSchema = z.enum(FUNNEL_INSTRUMENT_STATUSES);

export const FunnelOptionSchema = z
  .object({ key: z.string().min(1).max(64), label: z.string().min(1) })
  .strict();
export type FunnelOption = z.infer<typeof FunnelOptionSchema>;

/** A validated instrument's outcome. Scores never feed the rules. */
export const FunnelInstrumentSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().nullable(),
    status: FunnelInstrumentStatusSchema,
    total: z.number().int().min(0).nullable(),
    band: z.string().nullable(),
    /** Where v0.2 places it (and whether that placement is a default). */
    placement: z.string().min(1),
  })
  .strict();
export type FunnelInstrument = z.infer<typeof FunnelInstrumentSchema>;

/** The team panel on an interview screen: why this step, and what stands so far. */
export const FunnelStepPanelSchema = z
  .object({
    reason: z.string().nullable(),
    source: z.string().min(1),
    branchesOpened: z.array(z.string()),
    rulesFired: z.array(z.string()),
    mainAction: z.string().nullable(),
    phraseIds: z.array(z.string()),
    instruments: z.array(FunnelInstrumentSchema),
  })
  .strict();
export type FunnelStepPanel = z.infer<typeof FunnelStepPanelSchema>;

export const FunnelStepSchema = z
  .object({
    /** The answer key: the step id, plus "@stage" / "#item" where one question recurs. */
    key: z.string().min(1).max(64),
    /** The v0.2 question it shows (Q01, I2, S1, Z1, …) or the instrument. */
    questionId: z.string().min(1).max(64),
    kind: FunnelStepKindSchema,
    type: FunnelAnswerTypeSchema,
    /** Word for word: v0.2, an approved catalogue text, or an official instrument. */
    text: z.string().min(1),
    note: z.string().nullable(),
    options: z.array(FunnelOptionSchema),
    fields: z.array(FunnelOptionSchema),
    noneOption: z.boolean(),
    unit: z.string().nullable(),
    /** Units the person may pick for a duration. */
    units: z.array(z.string()),
    allowAbsence: z.boolean(),
    instrument: z
      .object({ code: z.string().min(1), name: z.string().min(1) })
      .strict()
      .nullable(),
    phase: FunnelPhaseSchema,
    answeredCount: z.number().int().min(0),
    panel: FunnelStepPanelSchema.nullable(),
  })
  .strict();
export type FunnelStep = z.infer<typeof FunnelStepSchema>;

export const FunnelTextSchema = z
  .object({ template: z.string().min(1), text: z.string().min(1) })
  .strict();
export type FunnelText = z.infer<typeof FunnelTextSchema>;

export const FunnelOrientationSchema = z
  .object({
    category: z.string().min(1),
    template: z.string().nullable(),
    rule: z.string().min(1),
    why: z.string().min(1),
  })
  .strict();

/** The team panel on the result: the same information as the vignette report. */
export const FunnelResultPanelSchema = z
  .object({
    ruleIds: z.array(z.string()),
    trace: z.array(z.string()),
    flags: z.array(z.string()),
    pendingData: z.array(z.string()),
    phraseIds: z.array(z.string()),
    branchesOpened: z.array(z.string()),
    orientations: z.array(FunnelOrientationSchema),
    /** Every instrument this interview would offer, pending ones included. */
    instruments: z.array(FunnelInstrumentSchema),
  })
  .strict();
export type FunnelResultPanel = z.infer<typeof FunnelResultPanelSchema>;

export const FunnelResultSchema = z
  .object({
    stoppedBy: z.string().nullable(),
    alerts: z.array(z.string()),
    mainAction: z.string().nullable(),
    associatedActions: z.array(z.string()),
    testToConsider: z.string().nullable(),
    /** The final text, paragraph by paragraph, exactly as the person reads it. */
    texts: z.array(FunnelTextSchema),
    /** The scores the person completed (skipped or pending ones are panel-only). */
    instruments: z.array(FunnelInstrumentSchema),
    /** v0.2 p. 14, shown with any score: "Ninguna escala confirma apnea…". */
    instrumentsNote: z.string().nullable(),
    contentVersion: z.string().min(1),
    rulesVersion: z.string().min(1),
    panel: FunnelResultPanelSchema.nullable(),
  })
  .strict();
export type FunnelResult = z.infer<typeof FunnelResultSchema>;

/** One answered step, shown back to the person so they can correct it (Z1). */
export const FunnelHistoryItemSchema = z
  .object({ key: z.string().min(1), question: z.string().min(1), answer: z.string() })
  .strict();
export type FunnelHistoryItem = z.infer<typeof FunnelHistoryItemSchema>;

export const FunnelStateSchema = z
  .object({
    sessionId: z.string().min(1),
    status: FunnelStatusSchema,
    step: FunnelStepSchema.nullable(),
    result: FunnelResultSchema.nullable(),
    history: z.array(FunnelHistoryItemSchema),
    /** Saved to a signed-in person's account from the start (their PDF is available). */
    owned: z.boolean(),
  })
  .strict();
export type FunnelState = z.infer<typeof FunnelStateSchema>;

/** Starts an interview. The health-data consent is required before anything is asked. */
export const FunnelCreateRequestSchema = z.object({ consentGiven: z.literal(true) }).strict();
export type FunnelCreateRequest = z.infer<typeof FunnelCreateRequestSchema>;

const noIdentifyingData = (text: string) => findIdentifyingData(text).length === 0;
const FreeTextSchema = z
  .string()
  .max(FREE_TEXT_MAX_LENGTH)
  .refine(noIdentifyingData, { message: "identifying_data" });

export const FunnelDurationSchema = z
  .object({ value: z.number().positive().max(1000), unit: z.string().min(1).max(16) })
  .strict();

/**
 * One answer, to the step the engine served (`key`). Exactly one of `value` and
 * `absence`. Free text never carries an email, a phone or a DNI/NIE: refused here
 * and again in morpheo.
 */
export const FunnelAnswerRequestSchema = z
  .object({
    key: z.string().min(1).max(64),
    value: z
      .union([
        FreeTextSchema,
        z.number().int().min(0).max(200),
        z.array(z.string().min(1).max(64)).max(20),
        FunnelDurationSchema,
        z.record(z.string().min(1).max(32), z.string().regex(/^\d{2}:\d{2}$/)),
      ])
      .nullable()
      .optional(),
    absence: FunnelAbsenceSchema.nullable().optional(),
    /** The note of a yes/no question that admits one. */
    text: FreeTextSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => (body.value != null) !== (body.absence != null), {
    message: "exactly one of value and absence",
  });
export type FunnelAnswerRequest = z.infer<typeof FunnelAnswerRequestSchema>;

/** Go back to an answered step to change it (Z1 correction): it and everything after it go. */
export const FunnelRewindRequestSchema = z.object({ key: z.string().min(1).max(64) }).strict();
export type FunnelRewindRequest = z.infer<typeof FunnelRewindRequestSchema>;

/** Which assessment flow the app runs: one config change rolls v2 back to v1. */
export const FunnelConfigResponseSchema = z.object({ activeFlow: z.enum(["v1", "v2"]) }).strict();
export type FunnelConfigResponse = z.infer<typeof FunnelConfigResponseSchema>;

/** The schemas exported as JSON Schema artifacts for morpheo's DTOs. */
export const FUNNEL_CONTRACT_SCHEMAS = {
  FunnelState: FunnelStateSchema,
  FunnelCreateRequest: FunnelCreateRequestSchema,
  FunnelAnswerRequest: FunnelAnswerRequestSchema,
  FunnelRewindRequest: FunnelRewindRequestSchema,
  FunnelConfigResponse: FunnelConfigResponseSchema,
} as const;
