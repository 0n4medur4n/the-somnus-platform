import { FREE_TEXT_MAX_LENGTH, type FunnelDictationSession } from "@somnus/api-contracts";

/**
 * Dictation of a free-text Morpheo answer (ADR 0026). The same path as a Drive
 * document: the voice goes from this browser straight to AssemblyAI's EU
 * streaming service, with a pass our worker issues that expires within a
 * minute. The audio never passes through our servers. The person is told so
 * once per page load before the microphone opens.
 */

/** Spoken punctuation and layout, per language; longer phrases first. */
const COMMANDS: Record<string, Array<[string[], string]>> = {
  es: [
    [["punto y aparte"], ".\n"],
    [["nuevo párrafo", "nuevo parrafo", "nueva línea", "nueva linea"], "\n"],
    [["punto y coma"], ";"],
    [["punto y seguido"], "."],
    [["dos puntos"], ":"],
    [["puntos suspensivos"], "…"],
    [["abrir interrogación", "abre interrogación", "abrir interrogacion"], "¿"],
    [["cerrar interrogación", "cierra interrogación", "cerrar interrogacion"], "?"],
    [["abrir exclamación", "abre exclamación", "abrir exclamacion"], "¡"],
    [["cerrar exclamación", "cierra exclamación", "cerrar exclamacion"], "!"],
    [["abrir paréntesis", "abre paréntesis", "abrir parentesis"], "("],
    [["cerrar paréntesis", "cierra paréntesis", "cerrar parentesis"], ")"],
    [["coma"], ","],
    [["punto"], "."],
  ],
  en: [
    [["new paragraph", "new line"], "\n"],
    [["full stop", "period"], "."],
    [["semicolon"], ";"],
    [["colon"], ":"],
    [["question mark"], "?"],
    [["exclamation mark", "exclamation point"], "!"],
    [["open bracket", "open parenthesis"], "("],
    [["close bracket", "close parenthesis"], ")"],
    [["comma"], ","],
    [["point"], "."],
  ],
  ca: [
    [["punt i a part"], ".\n"],
    [["nou paràgraf", "nova línia"], "\n"],
    [["punt i coma"], ";"],
    [["dos punts"], ":"],
    [["interrogant"], "?"],
    [["exclamació"], "!"],
    [["coma"], ","],
    [["punt"], "."],
  ],
  fr: [
    [["nouveau paragraphe", "à la ligne"], "\n"],
    [["point-virgule", "point virgule"], ";"],
    [["deux-points", "deux points"], ":"],
    [["point d'interrogation"], "?"],
    [["point d'exclamation"], "!"],
    [["virgule"], ","],
    [["point"], "."],
  ],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What was said, with spoken punctuation in place. */
export function spokenText(transcript: string, language: string): string {
  let text = ` ${transcript.trim()} `;
  for (const [phrases, mark] of COMMANDS[language.slice(0, 2).toLowerCase()] ?? []) {
    const opening = /^[¿¡(]$/.test(mark);
    const around = opening ? "\\s*" : "[\\s,.]*";
    const pattern = new RegExp(
      `${around}(?<![\\p{L}\\p{N}])(?:${phrases.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])${around}`,
      "giu",
    );
    text = text.replace(pattern, opening ? ` ${mark}` : `${mark} `);
  }
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/([¿¡(]) /g, "$1")
    .trim();
}

const CLOSING = /^[.,:;?!)…]/;
const OPENING = /[¿¡(\s]$/;
const SENTENCE_END = /[.?!¿¡…]\s*$/;

/** Adds a finished sentence to the box: a space, a capital, and a line break where said. */
export function appendDictation(current: string, transcript: string, language: string): string {
  let text = current;
  for (const [index, line] of spokenText(transcript, language).split("\n").entries()) {
    if (index > 0) text = `${text.replace(/\s*$/, "")}\n`;
    if (!line) continue;
    let piece = line;
    if (!text.trim() || SENTENCE_END.test(text) || text.endsWith("\n")) {
      piece = piece.replace(
        /^([¿¡(]?)(\p{Ll})/u,
        (_, open: string, letter: string) => `${open}${letter.toLocaleUpperCase()}`,
      );
    }
    // "punto y aparte" already brings its own full stop. Don't stack it on one
    // the previous sentence already has.
    if (piece.startsWith(".") && (text.endsWith(".") || text.endsWith(".\n"))) {
      piece = piece.slice(1).replace(/^\s*/, "");
    }
    if (text && !text.endsWith("\n") && !OPENING.test(text) && !CLOSING.test(piece)) {
      piece = ` ${piece}`;
    }
    text += piece;
  }
  return text.slice(0, FREE_TEXT_MAX_LENGTH);
}

export type DictationError = "denied" | "noMicrophone" | "network" | "unavailable" | "failed";

const WORKLET = `
class SomnusPcm extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.target;
    this.chunk = options.processorOptions.target / 10;
    this.out = new Int16Array(this.chunk);
    this.filled = 0;
    this.sum = 0;
    this.count = 0;
    this.carry = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count += 1;
      this.carry += 1;
      if (this.carry >= this.ratio) {
        this.carry -= this.ratio;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.out[this.filled++] = value < 0 ? value * 0x8000 : value * 0x7fff;
        this.sum = 0;
        this.count = 0;
        if (this.filled === this.chunk) {
          this.port.postMessage(this.out.buffer, [this.out.buffer]);
          this.out = new Int16Array(this.chunk);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("somnus-pcm", SomnusPcm);
`;

type TurnMessage = {
  type: "Turn";
  transcript?: unknown;
  end_of_turn?: unknown;
  turn_is_formatted?: unknown;
};

export type DictationRuntime = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  WebSocket: typeof WebSocket;
  AudioContext: typeof AudioContext;
};

function browserRuntime(): DictationRuntime | null {
  const scope = globalThis as unknown as Partial<DictationRuntime> & {
    navigator?: Navigator;
    AudioWorkletNode?: unknown;
  };
  const media = scope.navigator?.mediaDevices;
  if (!media?.getUserMedia || !scope.WebSocket || !scope.AudioContext || !scope.AudioWorkletNode) {
    return null;
  }
  return {
    getUserMedia: (constraints) => media.getUserMedia(constraints),
    WebSocket: scope.WebSocket,
    AudioContext: scope.AudioContext,
  };
}

export function dictationSupported(runtime: DictationRuntime | null = browserRuntime()): boolean {
  return runtime !== null;
}

/**
 * One dictation session. It reports what it hears as it hears it, and the
 * finished, punctuated sentence at the end of each turn.
 */
export async function startDictation(options: {
  open: () => Promise<FunnelDictationSession>;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (error: DictationError) => void;
  onStop: () => void;
  runtime?: DictationRuntime | null;
}): Promise<{ stop: () => void } | null> {
  const runtime = options.runtime === undefined ? browserRuntime() : options.runtime;
  if (!runtime) return null;

  let stream: MediaStream;
  try {
    stream = await runtime.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    options.onError(name === "NotFoundError" ? "noMicrophone" : "denied");
    options.onStop();
    return null;
  }

  let audio: AudioContext | null = null;
  let socket: WebSocket | null = null;
  let finished = false;
  let stopping = false;
  let farewell: ReturnType<typeof setTimeout> | null = null;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (farewell) clearTimeout(farewell);
    for (const track of stream.getTracks()) track.stop();
    void audio?.close().catch(() => {});
    if (socket && socket.readyState <= 1) socket.close(1000);
    options.onInterim("");
    options.onStop();
  };

  let session: FunnelDictationSession;
  try {
    session = await options.open();
  } catch {
    options.onError("unavailable");
    finish();
    return null;
  }

  try {
    audio = new runtime.AudioContext();
    await audio.resume();
    const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await audio.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);
    const source = audio.createMediaStreamSource(stream);
    const pcm = new AudioWorkletNode(audio, "somnus-pcm", {
      numberOfOutputs: 1,
      processorOptions: { target: session.sampleRate },
    });
    const mute = audio.createGain();
    mute.gain.value = 0;
    source.connect(pcm).connect(mute).connect(audio.destination);

    socket = new runtime.WebSocket(session.url);
    socket.binaryType = "arraybuffer";
    const open = socket;
    pcm.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!stopping && open.readyState === 1) open.send(event.data);
    };
    open.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let message: { type?: unknown };
      try {
        message = JSON.parse(event.data) as { type?: unknown };
      } catch {
        return;
      }
      if (message.type === "Turn") {
        const turn = message as TurnMessage;
        const text = typeof turn.transcript === "string" ? turn.transcript : "";
        if (turn.end_of_turn === true && turn.turn_is_formatted === true) {
          options.onInterim("");
          if (text.trim()) options.onFinal(text);
        } else {
          options.onInterim(text);
        }
      } else if (message.type === "Error") {
        options.onError("failed");
      } else if (message.type === "Termination") {
        finish();
      }
    };
    open.onerror = () => {
      if (!stopping) options.onError("network");
    };
    open.onclose = (event: CloseEvent) => {
      if (!stopping && event.code !== 1000) options.onError("network");
      finish();
    };
  } catch {
    options.onError("failed");
    finish();
    return null;
  }

  return {
    stop: () => {
      if (stopping || finished) return;
      stopping = true;
      if (socket?.readyState === 1) {
        socket.send(JSON.stringify({ type: "Terminate" }));
        farewell = setTimeout(finish, 4000);
      } else finish();
    },
  };
}

const noticesSeen = new Set<string>();

export function dictationNoticeSeen(): boolean {
  return noticesSeen.has("dictation");
}

export function acceptDictationNotice() {
  noticesSeen.add("dictation");
}

export function forgetDictationNotice() {
  noticesSeen.clear();
}
