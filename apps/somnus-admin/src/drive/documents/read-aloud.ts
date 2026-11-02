import {
  DRIVE_READ_ALOUD_MAX_BYTES,
  type DriveReadAloudResult,
  type DriveSpokenWord,
} from "@somnus/api-contracts";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Reading a Drive document aloud (owner decision 2026-11-02): the text goes, a
 * passage at a time, to Google Cloud Text-to-Speech in our own project, and the
 * MP3 that comes back plays here with the moment each word is spoken. The
 * passage and the word being read are highlighted and kept in view; the next
 * passages are asked for while one plays, so the voice does not stop between
 * them, and the reader can pause, go back, skip or jump.
 */

/**
 * A few sentences, about fifteen seconds: the warm voice reports no word times,
 * so they are worked out from each passage's length, and a short passage keeps
 * that close to the voice.
 */
const PASSAGE_CHARS = 300;
/** How many passages ahead are asked for while one plays. */
const AHEAD = 2;
/**
 * Passages translated in one request (owner decision 2026-11-03): about 2400
 * characters, under the contract's 4000, and a dozen seconds of listening
 * ahead of the voice.
 */
export const TRANSLATE_BATCH = 8;

/**
 * A stretch to read: its text, where its block is (to highlight it), and where
 * each character of the text is (`at[i]`, -1 for joins), to highlight a word.
 * In a document `from`, `to` and `at` are document positions; in a preview
 * `from` is the block's number and `at` holds offsets in the block's text.
 */
export type Passage = {
  text: string;
  from: number;
  to: number;
  whole: boolean;
  at: number[];
};

const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * Where to cut a long text, at sentence ends and then at spaces, so every
 * piece fits: `[start, end)` ranges over the text, trimmed of spaces.
 */
export function splitRanges(text: string): Array<[number, number]> {
  const trimmed = (start: number, end: number): [number, number] | null => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text[s] ?? "")) s++;
    while (e > s && /\s/.test(text[e - 1] ?? "")) e--;
    return s < e ? [s, e] : null;
  };
  if (text.length <= PASSAGE_CHARS && bytes(text) <= DRIVE_READ_ALOUD_MAX_BYTES) {
    const whole = trimmed(0, text.length);
    return whole ? [whole] : [];
  }
  const pieces: Array<[number, number]> = [];
  for (const match of text.matchAll(/[^.!?…]+[.!?…]*\s*/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (end - start <= PASSAGE_CHARS) pieces.push([start, end]);
    else
      for (const word of match[0].matchAll(/\S+\s*/g))
        pieces.push([start + word.index, start + word.index + word[0].length]);
  }
  const out: Array<[number, number]> = [];
  let current: [number, number] | null = null;
  for (const piece of pieces) {
    if (current && piece[1] - current[0] > PASSAGE_CHARS) {
      const kept = trimmed(current[0], current[1]);
      if (kept) out.push(kept);
      current = null;
    }
    current = current ? [current[0], piece[1]] : piece;
  }
  const last = current && trimmed(current[0], current[1]);
  if (last) out.push(last);
  return out;
}

/** The pieces of a long text, as strings. */
export function splitText(text: string): string[] {
  return splitRanges(text).map(([start, end]) => text.slice(start, end));
}

/**
 * Text with the location of each character, whitespace collapsed to single
 * spaces and trimmed, as a reader hears it.
 */
export function collapse(chars: Array<[string, number]>): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  let pending: number | null = null;
  for (const [char, where] of chars) {
    if (/\s/.test(char)) {
      if (text) pending ??= where;
      continue;
    }
    if (pending !== null) {
      text += " ";
      at.push(pending);
      pending = null;
    }
    text += char;
    at.push(where);
  }
  return { text, at };
}

/** A textblock's characters with their document positions; breaks read as spaces. */
function blockChars(node: PmNode, pos: number, from = 0, to = Number.POSITIVE_INFINITY) {
  const chars: Array<[string, number]> = [];
  node.forEach((child, offset) => {
    const start = pos + 1 + offset;
    if (child.isText) {
      const text = child.text ?? "";
      for (let i = 0; i < text.length; i++) {
        if (start + i >= from && start + i < to) chars.push([text[i] ?? "", start + i]);
      }
    } else if (start >= from && start < to) chars.push([" ", start]);
  });
  return chars;
}

/** A textblock's whole text as a reader hears it, with each character's document position. */
export function blockText(node: PmNode, pos: number): { text: string; at: number[] } {
  return collapse(blockChars(node, pos));
}

function piecesOf(text: string, at: number[], from: number, to: number, whole: boolean): Passage[] {
  return splitRanges(text).map(([start, end]) => ({
    text: text.slice(start, end),
    from,
    to,
    whole,
    at: at.slice(start, end),
  }));
}

/**
 * Passages from the blocks of a preview, by number: `from` is the block and
 * `at` the offset of each character in the block's text.
 */
export function passagesOfTexts(texts: string[]): Passage[] {
  return texts.flatMap((text, index) =>
    piecesOf(
      text,
      [...text].map((_, i) => i),
      index,
      index,
      true,
    ),
  );
}

/**
 * The passages from the paragraph at `from` to the end: every paragraph,
 * heading, list item and table cell, whole, in order. A paragraph read in
 * several pieces keeps the whole paragraph highlighted.
 */
export function passagesFrom(doc: PmNode, from: number): Passage[] {
  const out: Passage[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const end = pos + node.nodeSize;
    if (end <= from) return false;
    const { text, at } = collapse(blockChars(node, pos));
    out.push(...piecesOf(text, at, pos, end, true));
    return false;
  });
  return out;
}

/** The selection, read as it is, highlighted as it is; paragraphs joined by a pause. */
export function passagesOfSelection(doc: PmNode, from: number, to: number): Passage[] {
  const chars: Array<[string, number]> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    const block = blockChars(node, pos, from, to);
    if (block.length === 0) return false;
    const last = chars.findLast(([c]) => !/\s/.test(c))?.[0];
    if (last && !/[.!?:;…]/.test(last)) chars.push([".", -1]);
    if (chars.length > 0) chars.push([" ", -1]);
    chars.push(...block);
    return false;
  });
  const { text, at } = collapse(chars);
  return piecesOf(text, at, from, to, false);
}

/** The document range of a word of a passage, from its characters' positions. */
export function wordRange(passage: Passage, start: number, end: number): [number, number] | null {
  const located = passage.at.slice(start, end).filter((p) => p >= 0);
  const first = located[0];
  const last = located.at(-1);
  return first === undefined || last === undefined ? null : [first, last + 1];
}

type Highlight = {
  block: { from: number; to: number; whole: boolean } | null;
  word: { from: number; to: number } | null;
};

type HighlightMeta =
  | { kind: "passage"; passage: Passage | null }
  | { kind: "word"; range: [number, number] | null };

export const readingKey = new PluginKey<Highlight>("somnusReading");

/** Highlights what is being read, and the word being spoken. Decorations: never saved. */
export const ReadingMark = Extension.create({
  name: "somnusReading",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: readingKey,
        state: {
          init: (): Highlight => ({ block: null, word: null }),
          apply: (tr, value: Highlight): Highlight => {
            const meta = tr.getMeta(readingKey) as HighlightMeta | undefined;
            if (meta?.kind === "passage") {
              const p = meta.passage;
              return { block: p && { from: p.from, to: p.to, whole: p.whole }, word: null };
            }
            if (meta?.kind === "word") {
              const r = meta.range;
              return { ...value, word: r && { from: r[0], to: r[1] } };
            }
            const map = (n: number) => tr.mapping.map(n);
            return {
              block: value.block && {
                ...value.block,
                from: map(value.block.from),
                to: map(value.block.to),
              },
              word: value.word && { from: map(value.word.from), to: map(value.word.to) },
            };
          },
        },
        props: {
          decorations(state) {
            const { block, word } = readingKey.getState(state) ?? { block: null, word: null };
            const size = state.doc.content.size;
            const marks: Decoration[] = [];
            if (block && block.to <= size && block.from < block.to) {
              marks.push(
                block.whole
                  ? Decoration.node(block.from, block.to, { class: "somnus-reading" })
                  : Decoration.inline(block.from, block.to, { class: "somnus-reading" }),
              );
            }
            if (word && word.to <= size && word.from < word.to) {
              marks.push(Decoration.inline(word.from, word.to, { class: "somnus-reading-word" }));
            }
            return marks.length > 0 ? DecorationSet.create(state.doc, marks) : null;
          },
        },
      }),
    ];
  },
});

/** The transaction meta that moves the highlight to a passage. */
export function passageMeta(passage: Passage | null): HighlightMeta {
  return { kind: "passage", passage };
}

/** The transaction meta that moves the highlight to a word. */
export function wordMeta(range: [number, number] | null): HighlightMeta {
  return { kind: "word", range };
}

export type ReadAloudError = "unavailable" | "failed" | "translation";

/** What the reader shows: which passage, whether it plays, and how far in. */
export type ReaderState = {
  index: number;
  total: number;
  playing: boolean;
  loading: boolean;
  /** Seconds into the passage, and its length once known. */
  position: number;
  duration: number;
  /**
   * When translating: what the voice is saying, and the word it is on. The
   * words do not match the document's, so they are followed here instead.
   */
  caption: { text: string; word: [number, number] | null } | null;
};

/** A translation cut to what one request to the voice may carry, at a space. */
function fitted(text: string): string {
  if (bytes(text) <= DRIVE_READ_ALOUD_MAX_BYTES) return text;
  let cut = text;
  while (bytes(cut) > DRIVE_READ_ALOUD_MAX_BYTES) cut = cut.slice(0, Math.floor(cut.length * 0.9));
  const space = cut.lastIndexOf(" ");
  return space > 0 ? cut.slice(0, space) : cut;
}

/** The part of an HTMLAudioElement the reader uses, replaceable in tests. */
export type AudioOutput = {
  src: string;
  currentTime: number;
  readonly duration: number;
  play: () => Promise<void>;
  pause: () => void;
  onended: (() => void) | null;
  ontimeupdate: (() => void) | null;
  onloadedmetadata: (() => void) | null;
};

/** A passage ready to play: its audio, its word times, and the words it says. */
type Spoken = { url: string; words: DriveSpokenWord[]; text: string };

function spoken(result: DriveReadAloudResult, text: string): Spoken {
  const raw = atob(result.audio);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
  return {
    url: URL.createObjectURL(new Blob([data], { type: result.mime })),
    words: [...(result.words ?? [])].sort((a, b) => a.time - b.time),
    text,
  };
}

/** Roughly how long a word takes to say: its syllables, and the pause after it. */
function spokenWeight(word: string): number {
  const syllables = word.match(/[aeiouáéíóúàèòïüyAEIOUÁÉÍÓÚÀÈÒÏÜY]+/g)?.length ?? 0;
  const digits = word.match(/\d/g)?.length ?? 0;
  const pause = /[.!?…:]["»”)]*$/.test(word) ? 2.2 : /[,;]["»”)]*$/.test(word) ? 1.1 : 0;
  return Math.max(1, syllables + digits * 1.5) + pause;
}

/**
 * When each word is spoken, worked out from the audio's length when the voice
 * does not say: time shared by syllables, with pauses at punctuation, after the
 * short silence a voice starts with and before the one it ends with.
 */
export function estimateWords(text: string, duration: number): DriveSpokenWord[] {
  const words = [...text.matchAll(/\S+/g)];
  if (words.length === 0 || !(duration > 0)) return [];
  const lead = Math.min(0.15, duration * 0.05);
  const tail = Math.min(0.35, duration * 0.08);
  const weights = words.map((m) => spokenWeight(m[0]));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, duration - lead - tail);
  let elapsed = 0;
  return words.map((m, i) => {
    const time = lead + (span * elapsed) / total;
    elapsed += weights[i] ?? 0;
    return { start: m.index, end: m.index + m[0].length, time };
  });
}

/** The word being spoken at `time`: the last one that has started. */
export function wordAt(words: DriveSpokenWord[], time: number): DriveSpokenWord | null {
  let found: DriveSpokenWord | null = null;
  for (const word of words) {
    if (word.time > time) break;
    found = word;
  }
  return found;
}

export type Reader = {
  pause: () => void;
  resume: () => void;
  /** Jumps to a passage, playing it from its start. */
  seek: (index: number) => void;
  stop: () => void;
};

/** Reads `passages` in order, from the first, until the end or until stopped. */
export function startReader(options: {
  passages: Passage[];
  speak: (text: string) => Promise<DriveReadAloudResult>;
  onState: (state: ReaderState) => void;
  onPassage: (passage: Passage | null) => void;
  /** The word being spoken, as `[start, end)` in the passage's text, or null. */
  onWord?: (passage: Passage, word: [number, number] | null) => void;
  onError: (error: ReadAloudError) => void;
  onStop: () => void;
  /**
   * Puts passages into the voice's language before they are spoken, a batch
   * at a time; without it they are read as written.
   */
  translate?: (texts: string[]) => Promise<string[]>;
  audio?: AudioOutput;
  /** The display's frame clock, to follow words smoothly; replaceable in tests. */
  frame?: (callback: () => void) => () => void;
}): Reader {
  const { passages } = options;
  const audio: AudioOutput = options.audio ?? (new Audio() as unknown as AudioOutput);
  const frame =
    options.frame ??
    ((callback: () => void) => {
      const id = requestAnimationFrame(callback);
      return () => cancelAnimationFrame(id);
    });
  const fetched = new Map<number, Promise<Spoken>>();
  const batches = new Map<number, Promise<string[]>>();
  const translating = options.translate !== undefined;
  let index = 0;
  let saying = "";
  let playing = true;
  let loading = true;
  let stopped = false;
  let turn = 0;
  let words: DriveSpokenWord[] = [];
  let lastWord: DriveSpokenWord | null = null;
  let cancelFrame: (() => void) | null = null;

  const report = () =>
    options.onState({
      index,
      total: passages.length,
      playing,
      loading,
      position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
      caption:
        translating && !loading
          ? { text: saying, word: lastWord ? [lastWord.start, lastWord.end] : null }
          : null,
    });

  // Following the voice word by word: checked every frame while it plays.
  const follow = () => {
    cancelFrame = null;
    if (stopped || !playing || loading) return;
    const word = wordAt(words, audio.currentTime);
    const passage = passages[index];
    if (word !== lastWord && passage) {
      lastWord = word;
      // Translated words are not the document's: they are followed in the caption.
      if (translating) report();
      else options.onWord?.(passage, word ? [word.start, word.end] : null);
    }
    cancelFrame = frame(follow);
  };
  const startFollowing = () => {
    if (!cancelFrame && (options.onWord || translating) && words.length > 0) {
      cancelFrame = frame(follow);
    }
  };
  const stopFollowing = () => {
    cancelFrame?.();
    cancelFrame = null;
  };

  // The batch a passage belongs to, translated once however often it is heard.
  const wordsOf = (i: number): Promise<string> => {
    const passage = passages[i];
    const translate = options.translate;
    if (!passage) return Promise.resolve("");
    if (!translate) return Promise.resolve(passage.text);
    const batch = Math.floor(i / TRANSLATE_BATCH);
    let pending = batches.get(batch);
    if (!pending) {
      const first = batch * TRANSLATE_BATCH;
      pending = translate(passages.slice(first, first + TRANSLATE_BATCH).map((p) => p.text));
      pending.catch(() => {});
      batches.set(batch, pending);
    }
    return pending.then(
      (out) => fitted(out[i - batch * TRANSLATE_BATCH]?.trim() || passage.text),
      (error: unknown) => {
        throw Object.assign(new Error("translation"), { translation: true, cause: error });
      },
    );
  };

  const fetchPassage = (i: number) => {
    const passage = passages[i];
    if (!passage || fetched.has(i)) return;
    const pending = wordsOf(i).then((text) =>
      options.speak(text).then((result) => spoken(result, text)),
    );
    pending.catch(() => {});
    fetched.set(i, pending);
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    stopFollowing();
    audio.pause();
    audio.onended = audio.ontimeupdate = audio.onloadedmetadata = null;
    for (const pending of fetched.values()) {
      void pending.then(({ url }) => URL.revokeObjectURL(url)).catch(() => {});
    }
    options.onPassage(null);
    options.onStop();
  };

  const go = async (i: number) => {
    if (stopped) return;
    if (i >= passages.length) {
      finish();
      return;
    }
    const mine = ++turn;
    index = i;
    loading = true;
    stopFollowing();
    words = [];
    lastWord = null;
    options.onPassage(passages[i] ?? null);
    report();
    for (let ahead = 0; ahead <= AHEAD; ahead++) fetchPassage(i + ahead);
    // Translating: the next batch is asked for halfway through this one.
    if (translating && i % TRANSLATE_BATCH >= TRANSLATE_BATCH / 2) {
      void wordsOf(
        Math.min(passages.length - 1, (Math.floor(i / TRANSLATE_BATCH) + 1) * TRANSLATE_BATCH),
      ).catch(() => {});
    }
    let result: Spoken;
    try {
      result = await (fetched.get(i) as Promise<Spoken>);
    } catch (error) {
      if (stopped || mine !== turn) return;
      const status = (error as { status?: number }).status;
      options.onError(
        (error as { translation?: boolean }).translation
          ? "translation"
          : status === 502 || status === 503
            ? "unavailable"
            : "failed",
      );
      finish();
      return;
    }
    if (stopped || mine !== turn) return;
    audio.src = result.url;
    words = result.words;
    saying = result.text;
    // No word times from the voice: worked out once the audio's length is known.
    estimating = words.length === 0 ? result.text : null;
    loading = false;
    report();
    if (playing) {
      await audio.play().catch(() => {});
      startFollowing();
    }
  };

  let estimating: string | null = null;
  audio.onended = () => void go(index + 1);
  audio.ontimeupdate = report;
  audio.onloadedmetadata = () => {
    if (estimating !== null && Number.isFinite(audio.duration)) {
      words = estimateWords(estimating, audio.duration);
      estimating = null;
      if (playing && !loading) startFollowing();
    }
    report();
  };
  void go(0);

  return {
    pause: () => {
      playing = false;
      stopFollowing();
      audio.pause();
      report();
    },
    resume: () => {
      playing = true;
      report();
      if (!loading) {
        void audio.play().catch(() => {});
        startFollowing();
      }
    },
    seek: (i) => {
      audio.pause();
      void go(Math.max(0, Math.min(passages.length - 1, i)));
    },
    stop: finish,
  };
}
