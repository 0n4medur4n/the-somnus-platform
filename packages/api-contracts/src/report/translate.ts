import { z } from "zod";
import { DriveSpeechLangSchema } from "../drive/speech.js";

/**
 * Translating what is read aloud (owner decision 2026-11-03, ADR 0019): a
 * study in English, heard in Spanish. When the person turns translation on, the
 * passages about to be read go, a few at a time, to Gemini on Vertex AI in the
 * EU (through the report service, which holds the provider abstraction, build
 * plan §3.6) and come back in the voice's language. A passage already in that
 * language comes back as it was. The model only translates: it never scores,
 * flags or decides anything (§15).
 */

/** Passages per request: the reader asks for the next ones while it speaks. */
export const DRIVE_TRANSLATE_MAX_PASSAGES = 12;
/** All the passages of one request together, in characters. */
export const DRIVE_TRANSLATE_MAX_CHARS = 4000;

export const DriveTranslateRequestSchema = z.object({
  passages: z
    .array(z.string().min(1).max(600))
    .min(1)
    .max(DRIVE_TRANSLATE_MAX_PASSAGES)
    .refine((passages) => passages.join("").length <= DRIVE_TRANSLATE_MAX_CHARS, {
      message: `At most ${DRIVE_TRANSLATE_MAX_CHARS} characters in all.`,
    }),
  /** The language to translate into: the voice's. */
  lang: DriveSpeechLangSchema,
});
export type DriveTranslateRequest = z.infer<typeof DriveTranslateRequestSchema>;

/** One translation per passage asked for, in the same order. */
export const DriveTranslateResultSchema = z.object({
  passages: z.array(z.string().max(2000)).max(DRIVE_TRANSLATE_MAX_PASSAGES),
});
export type DriveTranslateResult = z.infer<typeof DriveTranslateResultSchema>;
