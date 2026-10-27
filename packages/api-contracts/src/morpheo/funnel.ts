import { z } from "zod";
import { FREE_TEXT_MAX_LENGTH, findIdentifyingData } from "./identifying-data.js";

/**
 * The Morpheo v2 interview (the embudo v0.2, ADR 0020) across edge <-> morpheo
 * and app <-> edge. The engine decides every step: the app only shows the step
 * it is given and sends back the answer to that step. Order, branches, rules,
 * the safety exceptions and the final text all live in morpheo.
 *
 * The final text comes only from the v0.2 templates and the approved phrase
 * catalogue -- no model writes any of it. The AI only proposes answers taken
 * from the person's own words (v0.2 p. 14), shown on a confirmation screen
 * (`confirm_extraction`); nothing it proposes counts until the person keeps or
 * corrects it there. `panel` (why a step was asked, the
 * branches, rules and phrases behind it) is for the team only: the edge strips
 * it for anyone without an internal role.
 */

/** "No lo sé" and "Prefiero no responder" (R03: unknown is never "No"). */
export const FUNNEL_ABSENCES = ["no_lo_se", "prefiero_no_responder"] as const;
export const FunnelAbsenceSchema = z.enum(FUNNEL_ABSENCES);
export type FunnelAbsence = z.infer<typeof FunnelAbsenceSchema>;

export const FUNNEL_STEP_KINDS = [
  "ask",
  "confirm",
  "info",
  "instrument_intro",
  "confirm_extraction",
] as const;
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
  "confirm_extraction",
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

/** The person's decision on one item the AI proposed. */
export const FUNNEL_EXTRACTION_DECISIONS = ["confirmado", "corregido", "quitado"] as const;
export const FunnelExtractionDecisionSchema = z.enum(FUNNEL_EXTRACTION_DECISIONS);
export type FunnelExtractionDecision = z.infer<typeof FunnelExtractionDecisionSchema>;

/** The risk screen's view of a safety question; it only ever adds a question. */
export const FunnelRiskSchema = z.enum(["si", "no", "dudoso"]);

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

/** For the team: one AI call -- what it proposed, the words it came from, what the person did. */
export const FunnelAiPanelSchema = z
  .object({
    /** The answer it read (Q01, Q06, …). */
    source: z.string().min(1),
    status: z.enum(["ok", "failed"]),
    model: z.string().nullable(),
    promptVersion: z.string().nullable(),
    risk: z
      .object({
        S1: FunnelRiskSchema.nullable(),
        S4: FunnelRiskSchema.nullable(),
        S2: FunnelRiskSchema.nullable(),
      })
      .strict(),
    /** Proposals dropped by validation (out of schema, or evidence not in the text). */
    discarded: z.number().int().min(0),
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          question: z.string().min(1),
          answer: z.string(),
          evidence: z.string().min(1),
          decision: z.enum([...FUNNEL_EXTRACTION_DECISIONS, "pendiente"]),
          /** The value the person gave instead, when they corrected it. */
          corrected: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type FunnelAiPanel = z.infer<typeof FunnelAiPanelSchema>;

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
    ai: z.array(FunnelAiPanelSchema),
  })
  .strict();
export type FunnelStepPanel = z.infer<typeof FunnelStepPanelSchema>;

/**
 * One item on the confirmation screen: the v0.2 question, what the AI took as
 * the answer, and the person's exact words it came from. An editable item
 * carries its question's answer shape so the person can correct it there.
 */
export const FunnelExtractionItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    question: z.string().min(1),
    answer: z.string(),
    evidence: z.string().min(1),
    editable: z.boolean(),
    type: FunnelAnswerTypeSchema,
    options: z.array(FunnelOptionSchema),
    fields: z.array(FunnelOptionSchema),
    noneOption: z.boolean(),
    unit: z.string().nullable(),
    units: z.array(z.string()),
  })
  .strict();
export type FunnelExtractionItem = z.infer<typeof FunnelExtractionItemSchema>;

export const FunnelExtractionSchema = z
  .object({ source: z.string().min(1), items: z.array(FunnelExtractionItemSchema).min(1) })
  .strict();
export type FunnelExtraction = z.infer<typeof FunnelExtractionSchema>;

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
    /** The confirmation screen's items (only on a `confirm_extraction` step). */
    extraction: FunnelExtractionSchema.nullable(),
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
    ai: z.array(FunnelAiPanelSchema),
  })
  .strict();
export type FunnelResultPanel = z.infer<typeof FunnelResultPanelSchema>;

/**
 * The patient's report (one page) and the professional's page, built by morpheo
 * from the engine's result -- never by a model. `status` says whether the clinical
 * lead has signed the texts: a "borrador" report is never sent to a patient.
 * Everything the person reads is an already approved sentence or a literal v0.2
 * phrase; the headline is the sentence of the approved template that says what to do.
 */
export const FunnelReportSchema = z
  .object({
    status: z.enum(["borrador", "aprobado"]),
    /** "urgent": only the urgent message (the texts), nothing else. */
    layout: z.enum(["urgent", "standard"]),
    headline: z.array(z.string()),
    secondary: z.array(z.string()),
    /** What the person confirmed in Z1, as a sentence continuing «Esto es lo que he entendido:». */
    summary: z.string().nullable(),
    steps: z.array(z.string()),
    help: z
      .object({
        sentences: z.array(z.string()),
        resources: z.array(z.object({ code: z.string().min(1), text: z.string().min(1) }).strict()),
      })
      .strict(),
    limits: z.array(z.string()),
    /** The v0.2 p. 15 sources behind the orientation, as that page writes them. */
    sources: z.array(z.string()),
    professional: z
      .object({
        mainAction: z.string().nullable(),
        associatedActions: z.array(z.string()),
        templates: z.array(z.string()),
        rules: z.array(z.string()),
        flags: z.array(z.object({ id: z.string().min(1), reasons: z.array(z.string()) }).strict()),
        alerts: z.array(z.string()),
        pendingData: z.array(z.string()),
        safety: z.array(
          z
            .object({
              question: z.string().min(1),
              answer: z.string(),
              when: z.enum(["moment", "end", "confirmed"]),
            })
            .strict(),
        ),
        answers: z.array(
          z
            .object({
              id: z.string().min(1),
              question: z.string().min(1),
              answer: z.string(),
              origin: z.enum(["answered", "narrative", "corrected"]),
            })
            .strict(),
        ),
        narrative: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type FunnelReport = z.infer<typeof FunnelReportSchema>;

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
    /** The one-page report; absent until REPORT_V3_ENABLED, so older edges keep working. */
    report: FunnelReportSchema.nullable().optional(),
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

const FunnelValueSchema = z.union([
  FreeTextSchema,
  z.number().int().min(0).max(200),
  z.array(z.string().min(1).max(64)).max(20),
  FunnelDurationSchema,
  z.record(z.string().min(1).max(32), z.string().regex(/^\d{2}:\d{2}$/)),
]);

/** The person's decision on one proposed item; a correction carries its value. */
export const FunnelExtractionDecisionBodySchema = z
  .object({
    id: z.string().min(1).max(64),
    decision: FunnelExtractionDecisionSchema,
    value: FunnelValueSchema.nullable().optional(),
  })
  .strict();
export type FunnelExtractionDecisionBody = z.infer<typeof FunnelExtractionDecisionBodySchema>;

/**
 * One answer, to the step the engine served (`key`). Exactly one of `value`,
 * `absence` and `decisions` (the confirmation screen). Free text never carries
 * an email, a phone or a DNI/NIE: refused here and again in morpheo.
 */
export const FunnelAnswerRequestSchema = z
  .object({
    key: z.string().min(1).max(64),
    value: FunnelValueSchema.nullable().optional(),
    absence: FunnelAbsenceSchema.nullable().optional(),
    /** The note of a yes/no question that admits one. */
    text: FreeTextSchema.nullable().optional(),
    decisions: z.array(FunnelExtractionDecisionBodySchema).max(60).nullable().optional(),
  })
  .strict()
  .refine(
    (body) =>
      [body.value != null, body.absence != null, body.decisions != null].filter(Boolean).length ===
      1,
    { message: "exactly one of value, absence and decisions" },
  );
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
