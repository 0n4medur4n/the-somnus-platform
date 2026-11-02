import type { DriveDictationSession } from "@somnus/api-contracts";
import type { Editor } from "@tiptap/core";

/**
 * Dictation in Drive documents (owner decision 2026-11-02): the voice goes from
 * this browser straight to AssemblyAI's EU streaming service, with a pass that
 * our worker issues and that expires within a minute. The audio never passes
 * through our servers, and it leaves the Drive's encryption: the person is
 * told so once per session (until the page is reloaded) before the microphone
 * opens.
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

/**
 * What was said, with spoken punctuation in place: "hola coma qué tal punto" is
 * "hola, qué tal.", and "nuevo párrafo" a line break ("\n"). The service already
 * punctuates on its own; a mark it added beside a spoken one is kept once.
 */
export function spokenText(transcript: string, language: string): string {
  let text = ` ${transcript.trim()} `;
  for (const [phrases, mark] of COMMANDS[language.slice(0, 2).toLowerCase()] ?? []) {
    const opening = /^[¿¡(]$/.test(mark);
    // A closing mark replaces any comma or full stop the service put around the
    // spoken word; an opening one leaves the sentence before it alone.
    const around = opening ? "\\s*" : "[\\s,.]*";
    const pattern = new RegExp(
      `${around}(?<![\\p{L}\\p{N}])(?:${phrases.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])${around}`,
      "giu",
    );
    // Closing marks stick to the word before; opening ones to the word after.
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

/**
 * Puts dictated text at the caret: a space before it where one is needed, a
 * capital where a sentence starts, and a new paragraph for each line break.
 */
export function insertDictation(editor: Editor, text: string) {
  text.split("\n").forEach((line, index) => {
    if (index > 0) editor.chain().focus().splitBlock().run();
    if (!line) return;
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, " ");
    let piece = line;
    if (!before.trim() || SENTENCE_END.test(before)) {
      piece = piece.replace(
        /^([¿¡(]?)(\p{Ll})/u,
        (_, open: string, letter: string) => `${open}${letter.toLocaleUpperCase()}`,
      );
    }
    if (before && !OPENING.test(before) && !CLOSING.test(piece)) piece = ` ${piece}`;
    editor.chain().focus().insertContent({ type: "text", text: piece }).run();
  });
}

export type DictationError = "denied" | "noMicrophone" | "network" | "unavailable" | "failed";

/**
 * Runs in the audio thread: averages the microphone's samples down to 16 kHz
 * and posts them as 16-bit PCM, 100 ms at a time, which is what the service
 * takes (between 50 and 1000 ms per message).
 */
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

/** Browser pieces, replaceable in tests. */
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
 * One dictation session: the microphone, a pass from our server, and the
 * stream to the service. It reports what it hears as it hears it, and the
 * finished, punctuated sentence at the end of each turn. Stopping asks the
 * service to finish the last sentence before the stream closes, since the
 * service bills the time a stream is open.
 */
export async function startDictation(options: {
  open: () => Promise<DriveDictationSession>;
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

  let session: DriveDictationSession;
  try {
    session = await options.open();
  } catch {
    options.onError("unavailable");
    finish();
    return null;
  }

  try {
    audio = new runtime.AudioContext();
    // Made after waiting for the microphone and the pass, so no longer inside
    // the click: browsers start it suspended.
    await audio.resume();
    const workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    await audio.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);
    const source = audio.createMediaStreamSource(stream);
    const pcm = new AudioWorkletNode(audio, "somnus-pcm", {
      numberOfOutputs: 1,
      processorOptions: { target: session.sampleRate },
    });
    // Silent, but connected: the audio graph only runs what reaches the output.
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
        // A turn is done when it is both ended and formatted; until then it is a draft.
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
        // The last sentence arrives before Termination; give it a moment.
        socket.send(JSON.stringify({ type: "Terminate" }));
        farewell = setTimeout(finish, 4000);
      } else finish();
    },
  };
}

// Remembered in memory only, like everything else the Drive holds: the notice
// shows again after a reload, which is also when the Drive asks to be unlocked.
type NoticeKind = "dictation" | "readAloud" | "proofread";
const noticesSeen = new Set<NoticeKind>();

/** Whether the "this leaves the Drive's encryption" notice was accepted in this session. */
export function speechNoticeSeen(kind: NoticeKind): boolean {
  return noticesSeen.has(kind);
}

export function acceptSpeechNotice(kind: NoticeKind) {
  noticesSeen.add(kind);
}

/** For tests: as after a reload. */
export function forgetSpeechNotices() {
  noticesSeen.clear();
}
