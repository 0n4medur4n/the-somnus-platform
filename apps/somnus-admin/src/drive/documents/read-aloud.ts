import { DRIVE_READ_ALOUD_MAX_BYTES, type DriveReadAloudResult } from "@somnus/api-contracts";

/**
 * Reading a Drive document aloud (owner decision 2026-11-02): the text goes, a
 * passage at a time, to Google Cloud Text-to-Speech in our own project, and the
 * MP3 that comes back plays here. The next passage is asked for while one plays,
 * so the voice does not stop between them.
 */

/** About a minute of speech: short enough to start soon, long enough to flow. */
const PASSAGE_CHARS = 900;

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A long text cut at sentence ends, then at spaces, so every piece fits Google's limit. */
function split(text: string): string[] {
  if (text.length <= PASSAGE_CHARS && bytes(text) <= DRIVE_READ_ALOUD_MAX_BYTES) return [text];
  const out: string[] = [];
  let current = "";
  for (const sentence of text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [text]) {
    for (const piece of sentence.length > PASSAGE_CHARS ? sentence.split(/(?<=\s)/) : [sentence]) {
      if (current && current.length + piece.length > PASSAGE_CHARS) {
        out.push(current.trim());
        current = "";
      }
      current += piece;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The blocks of a document, grouped into passages to send one at a time. */
export function passagesOf(blocks: string[]): string[] {
  const out: string[] = [];
  let current = "";
  for (const block of blocks.map((b) => b.trim()).filter(Boolean)) {
    for (const piece of split(block)) {
      if (current && current.length + piece.length + 1 > PASSAGE_CHARS) {
        out.push(current);
        current = "";
      }
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

export type ReadAloudError = "unavailable" | "failed";

/** A player, replaceable in tests. */
export type AudioPlayer = {
  play: (url: string) => Promise<void>;
  stop: () => void;
};

function browserPlayer(): AudioPlayer {
  let audio: HTMLAudioElement | null = null;
  let done: (() => void) | null = null;
  return {
    play: (url) =>
      new Promise<void>((resolve, reject) => {
        done = resolve;
        audio = new Audio(url);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("audio"));
        audio.play().catch(reject);
      }),
    // Stopping ends the passage playing now, as if it had finished.
    stop: () => {
      audio?.pause();
      audio = null;
      done?.();
    },
  };
}

function audioUrl(result: DriveReadAloudResult): string {
  const raw = atob(result.audio);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
  return URL.createObjectURL(new Blob([data], { type: result.mime }));
}

/** Reads `passages` in order until the end or until stopped. */
export function startReadAloud(options: {
  passages: string[];
  speak: (text: string) => Promise<DriveReadAloudResult>;
  onPassage: (index: number) => void;
  onError: (error: ReadAloudError) => void;
  onStop: () => void;
  player?: AudioPlayer;
}): { stop: () => void } {
  const player = options.player ?? browserPlayer();
  let stopped = false;
  const fetched = new Map<number, Promise<string>>();
  const fetch = (index: number) => {
    const text = options.passages[index];
    if (text === undefined || fetched.has(index)) return;
    fetched.set(index, options.speak(text).then(audioUrl));
  };

  void (async () => {
    try {
      for (let index = 0; index < options.passages.length && !stopped; index++) {
        fetch(index);
        fetch(index + 1);
        const url = await (fetched.get(index) as Promise<string>);
        if (stopped) break;
        options.onPassage(index);
        try {
          await player.play(url);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      if (!stopped) {
        const status = (error as { status?: number }).status;
        options.onError(status === 502 || status === 503 ? "unavailable" : "failed");
      }
    } finally {
      for (const pending of fetched.values()) {
        void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
      }
      stopped = true;
      options.onStop();
    }
  })();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      player.stop();
    },
  };
}
