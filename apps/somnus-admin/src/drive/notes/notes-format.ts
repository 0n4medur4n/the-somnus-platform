/**
 * Notes on a file (owner decision 2026-11-01): what the team writes beside a
 * protocol, a question or a page. They live in a companion Drive file next to
 * the file they annotate, under the same folder key and signatures, so the
 * server sees one more opaque file and nothing of what they say. Anyone who can
 * open the folder can read them; anyone who can edit it can write them.
 *
 * The companion is signed as a whole by whoever wrote last, so `authorId` says
 * who wrote a note to colleagues who already share the folder; it proves nothing
 * against a member who rewrites the file.
 */
export const NOTES_MIME = "application/vnd.somnus.notes+json";
export const NOTE_MAX_LENGTH = 4000;

/** How much of a block a note remembers, to find it again if the text moves. */
const QUOTE_LENGTH = 200;
/** The longest phrase a mark or a comment can hold. */
export const PHRASE_LENGTH = 1000;

/** The highlighter colours for marking a phrase (owner decision 2026-11-02). */
export const MARK_COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;
export type MarkColor = (typeof MARK_COLORS)[number];
export const MARK_HEX: Record<MarkColor, string> = {
  yellow: "#fff176",
  green: "#b9f6ca",
  blue: "#bbdefb",
  pink: "#f8bbd0",
  orange: "#ffcc80",
};

export type NoteAnchor =
  | { kind: "general" }
  | { kind: "page"; page: number }
  | { kind: "block"; quote: string; index: number }
  /**
   * A phrase: marked in a colour, and commented if the note has text. `index`
   * is the block (a PDF's page, from 0) and `quote` its opening, as for a block
   * note; `start` and `end` are offsets in the block's whole text, as a reader
   * hears it, and `phrase` the words there, to find them again if they move.
   */
  | {
      kind: "text";
      quote: string;
      index: number;
      phrase: string;
      start: number;
      end: number;
      color: MarkColor;
    };

export type DriveNote = {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  done: boolean;
  anchor: NoteAnchor;
};

type StoredNotes = { format: "somnus-notes"; version: 1; notes: DriveNote[] };

export function normalizeQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, QUOTE_LENGTH);
}

function cleanAnchor(value: unknown): NoteAnchor | null {
  const anchor = value as Partial<{ kind: string; page: number; quote: string; index: number }>;
  if (typeof anchor !== "object" || anchor === null) return null;
  if (anchor.kind === "general") return { kind: "general" };
  if (anchor.kind === "page") {
    const { page } = anchor;
    return Number.isInteger(page) && (page as number) > 0
      ? { kind: "page", page: page as number }
      : null;
  }
  if (anchor.kind === "block") {
    const { quote, index } = anchor;
    return typeof quote === "string" && Number.isInteger(index) && (index as number) >= 0
      ? { kind: "block", quote: quote.slice(0, QUOTE_LENGTH), index: index as number }
      : null;
  }
  if (anchor.kind === "text") {
    const text = value as Partial<{ phrase: string; start: number; end: number; color: string }>;
    const { quote, index } = anchor;
    const { phrase, start, end, color } = text;
    if (typeof quote !== "string" || typeof phrase !== "string" || phrase === "") return null;
    if (!Number.isInteger(index) || (index as number) < 0) return null;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
    if ((start as number) < 0 || (end as number) <= (start as number)) return null;
    return {
      kind: "text",
      quote: quote.slice(0, QUOTE_LENGTH),
      index: index as number,
      phrase: phrase.slice(0, PHRASE_LENGTH),
      start: start as number,
      end: end as number,
      color: MARK_COLORS.includes(color as MarkColor) ? (color as MarkColor) : "yellow",
    };
  }
  return null;
}

function cleanNote(value: unknown): DriveNote | null {
  const note = value as Partial<DriveNote>;
  if (typeof note !== "object" || note === null) return null;
  const anchor = cleanAnchor(note.anchor);
  const { id, authorId, text, createdAt } = note;
  if (!anchor || typeof id !== "string" || typeof authorId !== "string") return null;
  if (typeof text !== "string" || typeof createdAt !== "string") return null;
  return {
    id,
    authorId,
    text: text.slice(0, NOTE_MAX_LENGTH),
    createdAt,
    done: note.done === true,
    anchor,
  };
}

export function encodeNotes(notes: DriveNote[]): Uint8Array {
  const stored: StoredNotes = { format: "somnus-notes", version: 1, notes };
  return new TextEncoder().encode(JSON.stringify(stored));
}

/** The stored notes; anything that is not a note is dropped, never trusted. */
export function decodeNotes(bytes: Uint8Array): DriveNote[] {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<StoredNotes>;
    if (parsed.format !== "somnus-notes" || !Array.isArray(parsed.notes)) return [];
    return parsed.notes.map(cleanNote).filter((note): note is DriveNote => note !== null);
  } catch {
    return [];
  }
}

/**
 * The block a note belongs to, among the blocks now on screen: where it was, or
 * wherever that text went. Null when the text is gone; the note is still listed.
 */
export function blockOf(note: DriveNote, blocks: readonly string[]): number | null {
  if (note.anchor.kind !== "block" && note.anchor.kind !== "text") return null;
  const { quote, index } = note.anchor;
  const at = blocks[index];
  if (at?.startsWith(quote)) return index;
  const moved = blocks.findIndex((block) => block.startsWith(quote));
  return moved >= 0 ? moved : null;
}

export type BlockMark = { index: number; count: number; done: boolean };

/** What to highlight: each block with notes, and whether all of them are resolved. */
export function marksFor(notes: readonly DriveNote[], blocks: readonly string[]): BlockMark[] {
  const marks = new Map<number, BlockMark>();
  for (const note of notes) {
    // A phrase has its own mark, in its colour, not the block's.
    if (note.anchor.kind === "text") continue;
    const index = blockOf(note, blocks);
    if (index === null) continue;
    const mark = marks.get(index) ?? { index, count: 0, done: true };
    marks.set(index, { index, count: mark.count + 1, done: mark.done && note.done });
  }
  return [...marks.values()];
}

/** The order of the list: as they appear in the file, then the ones with no place in it. */
export function orderNotes(notes: readonly DriveNote[], blocks: readonly string[]): DriveNote[] {
  const place = (note: DriveNote): number => {
    if (note.anchor.kind === "page") return note.anchor.page;
    if (note.anchor.kind === "general") return -1;
    return blockOf(note, blocks) ?? Number.MAX_SAFE_INTEGER;
  };
  return [...notes].sort((a, b) => place(a) - place(b) || a.createdAt.localeCompare(b.createdAt));
}

export type TextMark = { id: string; index: number; start: number; end: number; color: MarkColor };

/**
 * Where each marked phrase is now, in the blocks' whole texts: where it was if
 * the words are still there, or wherever in its block they went. A phrase whose
 * words are gone has no mark, and its note stays listed.
 */
export function textMarksFor(
  notes: readonly DriveNote[],
  fullBlocks: readonly string[],
): TextMark[] {
  const quotes = fullBlocks.map(normalizeQuote);
  const out: TextMark[] = [];
  for (const note of notes) {
    const { anchor } = note;
    if (anchor.kind !== "text") continue;
    const index = blockOf(note, quotes);
    const text = index === null ? undefined : fullBlocks[index];
    if (index === null || text === undefined) continue;
    let start = anchor.start;
    if (text.slice(start, anchor.end) !== anchor.phrase) start = text.indexOf(anchor.phrase);
    if (start < 0) continue;
    out.push({ id: note.id, index, start, end: start + anchor.phrase.length, color: anchor.color });
  }
  return out;
}

/**
 * The anchor for a phrase chosen in a block's whole text, or null when the
 * choice does not fit the text (the offsets came from a frame: they are checked
 * here against the text the console holds, and the phrase is taken from it).
 */
export function phraseAnchor(
  fullBlocks: readonly string[],
  index: unknown,
  start: unknown,
  end: unknown,
  color: MarkColor,
): NoteAnchor | null {
  if (!Number.isInteger(index) || !Number.isInteger(start) || !Number.isInteger(end)) return null;
  const text = fullBlocks[index as number];
  if (text === undefined || (start as number) < 0 || (end as number) > text.length) return null;
  // A double click takes the space after a word: the mark is the words only.
  let from = start as number;
  let to = end as number;
  while (from < to && /\s/.test(text[from] ?? "")) from++;
  while (to > from && /\s/.test(text[to - 1] ?? "")) to--;
  if (to <= from) return null;
  const phrase = text.slice(from, to).slice(0, PHRASE_LENGTH);
  return {
    kind: "text",
    quote: normalizeQuote(text),
    index: index as number,
    phrase,
    start: from,
    end: from + phrase.length,
    color,
  };
}
