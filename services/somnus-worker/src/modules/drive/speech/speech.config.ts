import { z } from "zod";

/**
 * Voice in Drive documents (owner decision 2026-11-02, ADR 0019).
 *
 * Dictation needs AssemblyAI's API key, from Secret Manager; it stays on the
 * worker, which hands the browser a token that expires within a minute.
 * Reading aloud uses Google Cloud Text-to-Speech in our own project, with the
 * worker's own identity: no key at all. Each is off until configured, so local
 * development and tests never reach either service.
 */
export const SpeechConfigSchema = z.object({
  ASSEMBLYAI_API_KEY: z.string().default(""),
  ASSEMBLYAI_TOKEN_URL: z.url().default("https://streaming.assemblyai.com/v3/token"),
  // The EU host: audio and transcripts are processed in the EU.
  ASSEMBLYAI_STREAMING_URL: z
    .string()
    .regex(/^wss:\/\/[a-z0-9.-]+\.assemblyai\.com\/v3\/ws$/, "must be AssemblyAI streaming")
    .default("wss://streaming.eu.assemblyai.com/v3/ws"),
  TTS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Chirp 3: HD voices on the EU endpoint (owner decision 2026-11-02): the text
  // is turned into speech in the EU.
  TTS_ENDPOINT: z.url().default("https://eu-texttospeech.googleapis.com"),
  // Catalan has no Chirp 3 voice; its one voice is served where Google serves it.
  TTS_ENDPOINT_CA: z.url().default("https://texttospeech.googleapis.com"),
  TTS_VOICE_ES: z.string().default("es-ES-Chirp3-HD-Kore"),
  TTS_VOICE_EN: z.string().default("en-GB-Chirp3-HD-Kore"),
  TTS_VOICE_CA: z.string().default("ca-ES-Standard-B"),
  TTS_VOICE_FR: z.string().default("fr-FR-Chirp3-HD-Kore"),
});

export type SpeechConfig = z.infer<typeof SpeechConfigSchema>;

export function loadSpeechConfig(env: NodeJS.ProcessEnv = process.env): SpeechConfig {
  const result = SpeechConfigSchema.safeParse(env);
  if (!result.success) {
    console.error(`[speech-config] FATAL: invalid configuration:
${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
