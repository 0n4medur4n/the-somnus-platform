import { DRIVE_READ_ALOUD_MAX_BYTES, type DriveReadAloudResult } from "@somnus/api-contracts";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Reading a Drive document aloud (owner decision 2026-11-02): the text goes, a
 * passage at a time, to Google Cloud Text-to-Speech in our own project, and the
 * MP3 that comes back plays here. The passage being read is highlighted and
 * kept in view; the next ones are asked for while one plays, so the voice does
 * not stop between them, and the reader can pause, go back, skip or jump.
 */

/** About a minute of speech at most: a long paragraph is read in pieces. */
const PASSAGE_CHARS = 900;
/** How many passages ahead are asked for while one plays. */
const AHEAD = 2;

/** A stretch of the document to read: its text, and where it is, to highlight it. */
export type Passage = { text: string; from: number; to: number; whole: boolean };

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A long text cut at sentence ends, then at spaces, so every piece fits Google's limit. */
export function splitText(text: string): string[] {
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
    const text = node.textBetween(0, node.content.size, " ", " ").replace(/\s+/g, " ").trim();
    for (const piece of text ? splitText(text) : []) {
      out.push({ text: piece, from: pos, to: end, whole: true });
    }
    return false;
  });
  return out;
}

/** The selection, read as it is, highlighted as it is. */
export function passagesOfSelection(doc: PmNode, from: number, to: number): Passage[] {
  const text = doc
    .textBetween(from, to, "\n", " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  return splitText(text.replace(/\s*\n\s*/g, ". ").replace(/\.\.+/g, "."))
    .filter(Boolean)
    .map((piece) => ({ text: piece, from, to, whole: false }));
}

type Highlight = { from: number; to: number; whole: boolean };

export const readingKey = new PluginKey<Highlight | null>("somnusReading");

/** Highlights what is being read. A decoration: not content, never saved. */
export const ReadingMark = Extension.create({
  name: "somnusReading",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: readingKey,
        state: {
          init: (): Highlight | null => null,
          apply: (tr, value: Highlight | null): Highlight | null => {
            const meta = tr.getMeta(readingKey) as Passage | null | undefined;
            if (meta !== undefined) {
              return meta && { from: meta.from, to: meta.to, whole: meta.whole };
            }
            return (
              value && { ...value, from: tr.mapping.map(value.from), to: tr.mapping.map(value.to) }
            );
          },
        },
        props: {
          decorations(state) {
            const value = readingKey.getState(state);
            if (!value || value.to > state.doc.content.size || value.from >= value.to) return null;
            const mark = value.whole
              ? Decoration.node(value.from, value.to, { class: "somnus-reading" })
              : Decoration.inline(value.from, value.to, { class: "somnus-reading" });
            return DecorationSet.create(state.doc, [mark]);
          },
        },
      }),
    ];
  },
});

export type ReadAloudError = "unavailable" | "failed";

/** What the reader shows: which passage, whether it plays, and how far in. */
export type ReaderState = {
  index: number;
  total: number;
  playing: boolean;
  loading: boolean;
  /** Seconds into the passage, and its length once known. */
  position: number;
  duration: number;
};

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

function audioUrl(result: DriveReadAloudResult): string {
  const raw = atob(result.audio);
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
  return URL.createObjectURL(new Blob([data], { type: result.mime }));
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
  onError: (error: ReadAloudError) => void;
  onStop: () => void;
  audio?: AudioOutput;
}): Reader {
  const { passages } = options;
  const audio: AudioOutput = options.audio ?? (new Audio() as unknown as AudioOutput);
  const urls = new Map<number, Promise<string>>();
  let index = 0;
  let playing = true;
  let loading = true;
  let stopped = false;
  let turn = 0;

  const report = () =>
    options.onState({
      index,
      total: passages.length,
      playing,
      loading,
      position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });

  const fetchPassage = (i: number) => {
    const passage = passages[i];
    if (!passage || urls.has(i)) return;
    const pending = options.speak(passage.text).then(audioUrl);
    pending.catch(() => {});
    urls.set(i, pending);
  };

  const finish = () => {
    if (stopped) return;
    stopped = true;
    audio.pause();
    audio.onended = audio.ontimeupdate = audio.onloadedmetadata = null;
    for (const pending of urls.values()) {
      void pending.then((url) => URL.revokeObjectURL(url)).catch(() => {});
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
    options.onPassage(passages[i] ?? null);
    report();
    for (let ahead = 0; ahead <= AHEAD; ahead++) fetchPassage(i + ahead);
    let url: string;
    try {
      url = await (urls.get(i) as Promise<string>);
    } catch (error) {
      if (stopped || mine !== turn) return;
      const status = (error as { status?: number }).status;
      options.onError(status === 502 || status === 503 ? "unavailable" : "failed");
      finish();
      return;
    }
    if (stopped || mine !== turn) return;
    audio.src = url;
    loading = false;
    report();
    if (playing) await audio.play().catch(() => {});
  };

  audio.onended = () => void go(index + 1);
  audio.ontimeupdate = report;
  audio.onloadedmetadata = report;
  void go(0);

  return {
    pause: () => {
      playing = false;
      audio.pause();
      report();
    },
    resume: () => {
      playing = true;
      report();
      if (!loading) void audio.play().catch(() => {});
    },
    seek: (i) => {
      audio.pause();
      void go(Math.max(0, Math.min(passages.length - 1, i)));
    },
    stop: finish,
  };
}
