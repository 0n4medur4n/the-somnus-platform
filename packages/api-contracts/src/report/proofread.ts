import { z } from "zod";
import { DriveSpeechLangSchema } from "../drive/speech.js";

/**
 * Proofreading a Drive document with AI (owner decision 2026-11-02, ADR 0019):
 * the only way a model ever reads Drive text, and only when the person asks.
 * The report service holds the provider abstraction (build plan §3.6) and calls
 * Gemini on Vertex AI in the EU. The model proposes corrections; the service
 * places each one in the text itself, and the person accepts or ignores it.
 * It never scores, flags or decides anything (§15): it fixes spelling,
 * grammar and punctuation in staff writing.
 */

/** A few paragraphs at a time: a request stays quick and its answer small. */
export const DRIVE_PROOFREAD_MAX_CHARS = 4000;
export const DRIVE_PROOFREAD_MAX_SUGGESTIONS = 100;

export const DriveProofreadRequestSchema = z.object({
  text: z.string().min(1).max(DRIVE_PROOFREAD_MAX_CHARS),
  lang: DriveSpeechLangSchema,
});
export type DriveProofreadRequest = z.infer<typeof DriveProofreadRequestSchema>;

/** One correction: the characters `[start, end)` of the text, and what to write instead. */
export const DriveProofreadSuggestionSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  replacement: z.string().max(400),
  reason: z.string().max(200),
});
export type DriveProofreadSuggestion = z.infer<typeof DriveProofreadSuggestionSchema>;

export const DriveProofreadResultSchema = z.object({
  suggestions: z.array(DriveProofreadSuggestionSchema).max(DRIVE_PROOFREAD_MAX_SUGGESTIONS),
});
export type DriveProofreadResult = z.infer<typeof DriveProofreadResultSchema>;
