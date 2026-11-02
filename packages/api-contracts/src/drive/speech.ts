import { z } from "zod";
import { base64Bytes } from "./drive.js";

/**
 * Voice in Drive documents (owner decision 2026-11-02, ADR 0019).
 *
 * These are the only Drive routes that carry readable content, and only because
 * the person asked for it: dictation sends their voice to AssemblyAI (EU), and
 * reading aloud sends the passage's text to Google Cloud Text-to-Speech in our
 * own project. The console says so before either starts.
 */

/** The languages the console offers; dictation and voices are chosen from them. */
export const DRIVE_SPEECH_LANGS = ["es", "en", "ca", "fr"] as const;
export const DriveSpeechLangSchema = z.enum(DRIVE_SPEECH_LANGS);
export type DriveSpeechLang = z.infer<typeof DriveSpeechLangSchema>;

/** Google's limit is 5000 bytes of input per request; the browser sends a passage at a time. */
export const DRIVE_READ_ALOUD_MAX_BYTES = 4800;
/** One minute of speech is far below this; it bounds what the edge forwards. */
export const DRIVE_READ_ALOUD_AUDIO_MAX_BYTES = 4 * 1024 * 1024;

/** The language the person dictates in. */
export const DriveDictationRequestSchema = z.object({ lang: DriveSpeechLangSchema });
export type DriveDictationRequest = z.infer<typeof DriveDictationRequestSchema>;

/**
 * A one-use pass for dictation: the browser opens `url` with `token` and sends
 * 16 kHz mono PCM. The token expires within a minute; the audio never passes
 * through our servers.
 */
export const DriveDictationSessionSchema = z.object({
  url: z
    .string()
    .max(2048)
    .regex(/^wss:\/\/[a-z0-9.-]+\.assemblyai\.com\/v3\/ws\?/, "must be AssemblyAI streaming"),
  sampleRate: z.literal(16_000),
  expiresInSeconds: z.number().int().min(1).max(600),
});
export type DriveDictationSession = z.infer<typeof DriveDictationSessionSchema>;

export const DriveReadAloudRequestSchema = z.object({
  text: z
    .string()
    .min(1)
    .refine(
      (text) => new TextEncoder().encode(text).length <= DRIVE_READ_ALOUD_MAX_BYTES,
      `must be at most ${DRIVE_READ_ALOUD_MAX_BYTES} bytes`,
    ),
  lang: DriveSpeechLangSchema,
});
export type DriveReadAloudRequest = z.infer<typeof DriveReadAloudRequestSchema>;

/** MP3, base64, as the internal hop is JSON. */
export const DriveReadAloudResultSchema = z.object({
  mime: z.literal("audio/mpeg"),
  audio: base64Bytes(1, DRIVE_READ_ALOUD_AUDIO_MAX_BYTES),
});
export type DriveReadAloudResult = z.infer<typeof DriveReadAloudResultSchema>;
