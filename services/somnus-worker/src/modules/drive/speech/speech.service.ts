import type {
  DriveDictationSession,
  DriveReadAloudResult,
  DriveSpeechLang,
} from "@somnus/api-contracts";
import { ErrorCode, SomnusError } from "@somnus/errors";
import type { SpeechConfig } from "./speech.config.js";

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/** How long the browser has to open the stream; the session itself may run longer. */
const TOKEN_SECONDS = 60;
/** AssemblyAI bills the time a stream is open: no session outlives half an hour. */
const SESSION_MAX_SECONDS = 1800;
/** A stream nobody speaks into closes itself after this long. */
const INACTIVITY_SECONDS = 30;

/** The worker's own access token, from the Cloud Run metadata server. */
async function metadataToken(): Promise<string> {
  const response = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
  if (!response.ok) throw new Error(`metadata token: ${response.status}`);
  const body = (await response.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") throw new Error("metadata token: no token");
  return body.access_token;
}

function unavailable(message: string): SomnusError {
  return new SomnusError(ErrorCode.UPSTREAM_UNAVAILABLE, message, { correlationId: "speech" });
}

/**
 * Dictation passes and spoken passages for Drive documents. Nothing here is
 * logged: what crosses it is a person's words. Upstream failures carry the
 * status code only.
 */
export class SpeechService {
  constructor(
    private readonly config: SpeechConfig,
    private readonly http: typeof fetch = fetch,
    private readonly accessToken: () => Promise<string> = metadataToken,
  ) {}

  /**
   * A pass to AssemblyAI's EU streaming endpoint. The multilingual model covers
   * Spanish, English and French at the standard price; Catalan needs the larger
   * model, which costs three times as much and is used only for it.
   */
  async dictationSession(lang: DriveSpeechLang): Promise<DriveDictationSession> {
    const key = this.config.ASSEMBLYAI_API_KEY;
    if (!key) throw unavailable("Dictation is not configured.");
    const tokenUrl = new URL(this.config.ASSEMBLYAI_TOKEN_URL);
    tokenUrl.searchParams.set("expires_in_seconds", String(TOKEN_SECONDS));
    tokenUrl.searchParams.set("max_session_duration_seconds", String(SESSION_MAX_SECONDS));
    const response = await this.http(tokenUrl, { headers: { authorization: key } });
    if (!response.ok) throw unavailable(`Dictation token refused: ${response.status}`);
    const body = (await response.json()) as { token?: unknown };
    // A signed JWT: longer than a kilobyte, and nowhere near this.
    if (typeof body.token !== "string" || body.token.length === 0 || body.token.length > 8192) {
      throw unavailable("Dictation token missing.");
    }

    const stream = new URL(this.config.ASSEMBLYAI_STREAMING_URL);
    stream.searchParams.set("sample_rate", "16000");
    stream.searchParams.set("encoding", "pcm_s16le");
    stream.searchParams.set("inactivity_timeout", String(INACTIVITY_SECONDS));
    if (lang === "ca") {
      stream.searchParams.set("speech_model", "universal-3-6-pro");
      stream.searchParams.set("language_codes", "ca");
    } else {
      stream.searchParams.set("speech_model", "universal-streaming-multilingual");
      // Punctuation and capitals in the finished sentence.
      stream.searchParams.set("format_turns", "true");
    }
    stream.searchParams.set("token", body.token);
    return { url: stream.toString(), sampleRate: 16_000, expiresInSeconds: TOKEN_SECONDS };
  }

  /** One passage spoken by Google's voice for `lang`, as MP3. */
  async readAloud(text: string, lang: DriveSpeechLang): Promise<DriveReadAloudResult> {
    if (!this.config.TTS_ENABLED) throw unavailable("Reading aloud is not configured.");
    const name = {
      es: this.config.TTS_VOICE_ES,
      en: this.config.TTS_VOICE_EN,
      ca: this.config.TTS_VOICE_CA,
      fr: this.config.TTS_VOICE_FR,
    }[lang];
    const token = await this.accessToken();
    const response = await this.http(`${this.config.TTS_ENDPOINT}/v1/text:synthesize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: name.split("-").slice(0, 2).join("-"), name },
        audioConfig: { audioEncoding: "MP3" },
      }),
    });
    if (!response.ok) throw unavailable(`Text-to-Speech refused: ${response.status}`);
    const body = (await response.json()) as { audioContent?: unknown };
    if (typeof body.audioContent !== "string" || body.audioContent.length === 0) {
      throw unavailable("Text-to-Speech returned no audio.");
    }
    return { mime: "audio/mpeg", audio: body.audioContent };
  }
}
