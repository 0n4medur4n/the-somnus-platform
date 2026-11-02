import type {
  DriveDictationSession,
  DriveReadAloudResult,
  DriveSpeechLang,
  DriveSpokenWord,
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

/** Google's input limit, SSML marks included. */
const SSML_MAX_BYTES = 5000;

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The passage as SSML with a mark before every `step`-th word, so the voice
 * reports when each is spoken. Words are runs of non-space characters.
 */
export function markedSsml(
  text: string,
  step = 1,
): { ssml: string; words: Array<[number, number]> } {
  const words = [...text.matchAll(/\S+/g)].map(
    (m) => [m.index, m.index + m[0].length] as [number, number],
  );
  let ssml = "<speak>";
  let at = 0;
  words.forEach(([start, end], i) => {
    ssml += escapeXml(text.slice(at, start));
    if (i % step === 0) ssml += `<mark name="${i}"/>`;
    ssml += escapeXml(text.slice(start, end));
    at = end;
  });
  return { ssml: `${ssml}${escapeXml(text.slice(at))}</speak>`, words };
}

/**
 * When each word is spoken. Words without a mark of their own (a long passage
 * marks every other word to fit Google's limit) are placed between their
 * neighbours by their position in the text.
 */
export function wordTimes(
  words: Array<[number, number]>,
  marks: Map<number, number>,
): DriveSpokenWord[] {
  const known = [...marks.entries()]
    .filter(([i]) => i >= 0 && i < words.length)
    .sort((a, b) => a[0] - b[0]);
  if (known.length === 0) return [];
  return words.map(([start, end], i) => {
    const exact = marks.get(i);
    if (exact !== undefined) return { start, end, time: exact };
    const before = [...known].reverse().find(([k]) => k < i);
    const after = known.find(([k]) => k > i);
    if (!before) return { start, end, time: after?.[1] ?? 0 };
    if (!after) return { start, end, time: before[1] };
    const from = words[before[0]]?.[0] ?? 0;
    const to = words[after[0]]?.[0] ?? from;
    const share = to > from ? (start - from) / (to - from) : 0;
    return { start, end, time: before[1] + (after[1] - before[1]) * share };
  });
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

  /**
   * One passage spoken by Google's voice for `lang`, as MP3, with the moment
   * each word is spoken (SSML marks and time pointing, v1beta1).
   */
  async readAloud(text: string, lang: DriveSpeechLang): Promise<DriveReadAloudResult> {
    if (!this.config.TTS_ENABLED) throw unavailable("Reading aloud is not configured.");
    const name = {
      es: this.config.TTS_VOICE_ES,
      en: this.config.TTS_VOICE_EN,
      ca: this.config.TTS_VOICE_CA,
      fr: this.config.TTS_VOICE_FR,
    }[lang];
    // Chirp 3: HD takes plain text and reports no word times; the others take
    // SSML with a mark on every word if it fits, otherwise every second, third...
    const reports = !name.includes("Chirp3");
    let step = 1;
    let marked = markedSsml(text, step);
    while (reports && new TextEncoder().encode(marked.ssml).length > SSML_MAX_BYTES && step < 50) {
      step += 1;
      marked = markedSsml(text, step);
    }
    const token = await this.accessToken();
    const response = await this.http(`${this.config.TTS_ENDPOINT}/v1beta1/text:synthesize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        input: reports ? { ssml: marked.ssml } : { text },
        voice: { languageCode: name.split("-").slice(0, 2).join("-"), name },
        audioConfig: { audioEncoding: "MP3" },
        ...(reports ? { enableTimePointing: ["SSML_MARK"] } : {}),
      }),
    });
    if (!response.ok) throw unavailable(`Text-to-Speech refused: ${response.status}`);
    const body = (await response.json()) as { audioContent?: unknown; timepoints?: unknown };
    if (typeof body.audioContent !== "string" || body.audioContent.length === 0) {
      throw unavailable("Text-to-Speech returned no audio.");
    }
    const marks = new Map<number, number>();
    for (const point of Array.isArray(body.timepoints) ? body.timepoints : []) {
      const { markName, timeSeconds } = point as { markName?: unknown; timeSeconds?: unknown };
      const index = Number(markName);
      if (Number.isInteger(index) && typeof timeSeconds === "number" && timeSeconds >= 0) {
        marks.set(index, Math.min(timeSeconds, 3600));
      }
    }
    const words = wordTimes(marked.words, marks);
    return { mime: "audio/mpeg", audio: body.audioContent, ...(words.length > 0 ? { words } : {}) };
  }
}
