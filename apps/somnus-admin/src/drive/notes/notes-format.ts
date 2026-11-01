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

export type NoteAnchor =
  | { kind: "general" }
  | { kind: "page"; page: number }
  | { kind: "block"; quote: string; index: number };

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
  if (note.anchor.kind !== "block") return null;
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
