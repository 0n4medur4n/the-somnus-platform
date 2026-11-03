import { z } from "zod";
import { FunnelHistoryItemSchema, FunnelStatusSchema } from "./funnel.js";

/**
 * The case record of each v2 interview (ADR 0024).
 *
 * Every interview gets a random case code (`SOM-7K3F-Q9XA`) the person sees with
 * their result and on their PDF. On each closure morpheo freezes what was asked,
 * answered and shown; answers taken back are recorded as they read; and the
 * case outlives the interview's own retention, with no link to a person once the
 * interview is deleted. No owner id, name or address is part of any of this.
 *
 * The console reads it in two ways only. Statistics are counts and nothing else.
 * Opening one case is the recorded exception, shaped like break-glass (§A2.3):
 * the category and the justification are required fields of the only request,
 * and morpheo writes the access before it answers.
 */

/** Crockford base32 groups: no I, L, O or U. */
export const FUNNEL_CASE_CODE_PATTERN = /^SOM-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/**
 * Why a case is opened. The same four as break-glass (`BREAK_GLASS_CATEGORIES`,
 * asserted equal by the test): an audit groups both kinds of access the same way.
 */
export const FUNNEL_CASE_ACCESS_CATEGORIES = ["support", "safety", "legal", "other"] as const;
export const FunnelCaseAccessCategorySchema = z.enum(FUNNEL_CASE_ACCESS_CATEGORIES);
export type FunnelCaseAccessCategory = z.infer<typeof FunnelCaseAccessCategorySchema>;

/** The break-glass bounds, for the same reason (asserted equal by the test). */
export const FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH = 20;
export const FUNNEL_CASE_JUSTIFICATION_MAX_LENGTH = 500;

/** `POST /admin/v1/morpheo/cases/open` and morpheo's `/internal/v1/funnel/cases/open`. */
export const FunnelCaseOpenRequestSchema = z
  .object({
    /** As typed: morpheo reads it back case- and dash-insensitively. */
    caseCode: z.string().trim().min(1).max(32),
    category: FunnelCaseAccessCategorySchema,
    justification: z
      .string()
      .trim()
      .min(FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH)
      .max(FUNNEL_CASE_JUSTIFICATION_MAX_LENGTH),
  })
  .strict();
export type FunnelCaseOpenRequest = z.infer<typeof FunnelCaseOpenRequestSchema>;

/** One closure, frozen: the questions as worded, the answers as labelled. */
export const FunnelCaseRecordSchema = z
  .object({
    recordedAt: z.iso.datetime({ offset: true }),
    status: FunnelStatusSchema,
    /**
     * Rebuilt from the stored answers for an interview closed before cases
     * existed: today's rules, not necessarily what the person was shown.
     */
    reconstructed: z.boolean(),
    contentVersion: z.string().min(1),
    rulesVersion: z.string().min(1),
    history: z.array(FunnelHistoryItemSchema),
    /**
     * The result exactly as it was serialised when the person saw it
     * (`FunnelResultSchema` at the time). Deliberately not re-validated here: a
     * later change to the result contract must not make an old record unreadable.
     */
    result: z.record(z.string(), z.unknown()),
  })
  .strict();
export type FunnelCaseRecord = z.infer<typeof FunnelCaseRecordSchema>;

/** Answers the person took back (back, or the Z1 correction), as they read. */
export const FunnelCaseChangeSchema = z
  .object({
    changedAt: z.iso.datetime({ offset: true }),
    withdrawn: z.array(FunnelHistoryItemSchema),
  })
  .strict();
export type FunnelCaseChange = z.infer<typeof FunnelCaseChangeSchema>;

/** Each time the case was opened in the console, this one included. */
export const FunnelCaseAccessSchema = z
  .object({
    accessedAt: z.iso.datetime({ offset: true }),
    /** The opaque internal-staff id, never a name or an address. */
    actorId: z.string().min(1),
    category: FunnelCaseAccessCategorySchema,
    justification: z.string(),
  })
  .strict();
export type FunnelCaseAccess = z.infer<typeof FunnelCaseAccessSchema>;

export const FunnelCaseSchema = z
  .object({
    caseCode: z.string().regex(FUNNEL_CASE_CODE_PATTERN),
    status: FunnelStatusSchema,
    startedAt: z.iso.datetime({ offset: true }),
    closedAt: z.iso.datetime({ offset: true }).nullable(),
    contentVersion: z.string().min(1),
    rulesVersion: z.string().min(1),
    /** The interview itself was deleted (TTL or account erasure): no link to anyone remains. */
    interviewDeleted: z.boolean(),
    records: z.array(FunnelCaseRecordSchema),
    changes: z.array(FunnelCaseChangeSchema),
    accesses: z.array(FunnelCaseAccessSchema),
  })
  .strict();
export type FunnelCase = z.infer<typeof FunnelCaseSchema>;

/** The window the statistics cover; either end may be open. */
export const FunnelCaseStatsRequestSchema = z
  .object({
    since: z.iso.datetime({ offset: true }).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type FunnelCaseStatsRequest = z.infer<typeof FunnelCaseStatsRequestSchema>;

export const FunnelCountSchema = z
  .object({ key: z.string().min(1), count: z.number().int().nonnegative() })
  .strict();
export type FunnelCount = z.infer<typeof FunnelCountSchema>;

const count = z.number().int().nonnegative();

/**
 * Counts over the cases started in the window. Never a case code, never a
 * session, never an answer: nothing here points at anyone.
 */
export const FunnelCaseStatsSchema = z
  .object({
    started: count,
    byStatus: z.object({ open: count, finished: count, stopped: count, paused: count }).strict(),
    /** The cases that closed; the breakdowns below are over these. */
    closed: count,
    /** The main action of each case's last closure (EMERGENCIA … SIN_ORIENTACION). */
    byMainAction: z.array(FunnelCountSchema),
    /** Each final-text template (T_INSOMNIO, T_PIERNAS…), once per case. */
    byTemplate: z.array(FunnelCountSchema),
    byAlert: z.array(FunnelCountSchema),
    withAlerts: count,
    byMonth: z.array(
      z
        .object({ month: z.string().regex(/^\d{4}-\d{2}$/), started: count, closed: count })
        .strict(),
    ),
    firstStartedAt: z.iso.datetime({ offset: true }).nullable(),
    lastStartedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type FunnelCaseStats = z.infer<typeof FunnelCaseStatsSchema>;

export const FunnelCaseBackfillResultSchema = z
  .object({ opened: count, unrebuilt: count })
  .strict();
export type FunnelCaseBackfillResult = z.infer<typeof FunnelCaseBackfillResultSchema>;

export const CASE_CONTRACT_SCHEMAS = {
  FunnelCaseOpenRequest: FunnelCaseOpenRequestSchema,
  FunnelCase: FunnelCaseSchema,
  FunnelCaseStatsRequest: FunnelCaseStatsRequestSchema,
  FunnelCaseStats: FunnelCaseStatsSchema,
  FunnelCaseBackfillResult: FunnelCaseBackfillResultSchema,
} as const;
