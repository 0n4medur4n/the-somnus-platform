import {
  DRIVE_PROOFREAD_MAX_CHARS,
  type DriveProofreadResult,
  type DriveSpeechLang,
} from "@somnus/api-contracts";
import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { blockText } from "./read-aloud.js";

/**
 * Proofreading a Drive document with AI (owner decision 2026-11-02, ADR 0019):
 * the text goes, a few paragraphs at a time, to Gemini in our Google Cloud (EU)
 * through the report service, and comes back as proposed corrections. Each is
 * placed on the words it changes and checked against them; the person accepts
 * or dismisses each one, or all, unless they chose to have them applied at once.
 */

/** A proposed correction, where it is in the document now. */
export type Suggestion = {
  id: string;
  from: number;
  to: number;
  original: string;
  replacement: string;
  reason: string;
};

/** A stretch of the document sent in one request, and where each character is. */
export type Chunk = { text: string; at: number[] };

/** The document's paragraphs, grouped into requests that fit the limit. */
/**
 * About a page per request: Gemini answers one in a few seconds, and several go
 * at once (see proofreadDocument).
 */
const CHUNK_CHARS = 1500;

export function chunksOf(
  doc: PmNode,
  limit = Math.min(CHUNK_CHARS, DRIVE_PROOFREAD_MAX_CHARS - 100),
): Chunk[] {
  const blocks: Chunk[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const { text, at } = blockText(node, pos);
    // A paragraph longer than a request is sent on its own, cut at the limit.
    for (let start = 0; start < text.length; start += limit) {
      blocks.push({ text: text.slice(start, start + limit), at: at.slice(start, start + limit) });
    }
    return false;
  });
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;
  for (const block of blocks.filter((b) => b.text.trim())) {
    if (current && current.text.length + 1 + block.text.length > limit) {
      chunks.push(current);
      current = null;
    }
    current = current
      ? { text: `${current.text}\n${block.text}`, at: [...current.at, -1, ...block.at] }
      : block;
  }
  if (current) chunks.push(current);
  return chunks;
}

let nextId = 0;

/**
 * The corrections that land on the document exactly: inside one paragraph, on
 * text that still reads the same. Anything else is dropped, never guessed.
 */
export function placeSuggestions(
  doc: PmNode,
  chunk: Chunk,
  result: DriveProofreadResult,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of result.suggestions) {
    if (s.end > chunk.text.length || s.start >= s.end) continue;
    const span = chunk.at.slice(s.start, s.end);
    if (span.includes(-1)) continue;
    const from = span[0];
    const last = span.at(-1);
    if (from === undefined || last === undefined) continue;
    const original = chunk.text.slice(s.start, s.end);
    if (doc.textBetween(from, last + 1, "\n", " ") !== original) continue;
    nextId += 1;
    out.push({
      id: `s${nextId}`,
      from,
      to: last + 1,
      original,
      replacement: s.replacement,
      reason: s.reason,
    });
  }
  return out;
}

type ProofState = { items: Suggestion[]; active: string | null };
type ProofMeta =
  | { kind: "set"; items: Suggestion[] }
  | { kind: "remove"; ids: string[] }
  | { kind: "active"; id: string | null };

export const proofKey = new PluginKey<ProofState>("somnusProofreading");

/** The suggestions as they stand. */
export function suggestionsOf(state: EditorState): ProofState {
  return proofKey.getState(state) ?? { items: [], active: null };
}

/** Writes a suggestion into the document, if its words are still there; then drops it. */
export function applySuggestions(state: EditorState, ids: string[]): Transaction | null {
  const { items } = suggestionsOf(state);
  const chosen = items
    .filter((item) => ids.includes(item.id))
    // From the end, so earlier positions stay valid.
    .sort((a, b) => b.from - a.from);
  if (chosen.length === 0) return null;
  let tr = state.tr;
  for (const item of chosen) {
    if (state.doc.textBetween(item.from, item.to, "\n", " ") !== item.original) continue;
    tr = tr.insertText(item.replacement, item.from, item.to);
  }
  return tr.setMeta(proofKey, { kind: "remove", ids } satisfies ProofMeta);
}

export function setSuggestions(tr: Transaction, items: Suggestion[]): Transaction {
  return tr.setMeta(proofKey, { kind: "set", items } satisfies ProofMeta);
}

export function dismissSuggestions(tr: Transaction, ids: string[]): Transaction {
  return tr.setMeta(proofKey, { kind: "remove", ids } satisfies ProofMeta);
}

export function activateSuggestion(tr: Transaction, id: string | null): Transaction {
  return tr.setMeta(proofKey, { kind: "active", id } satisfies ProofMeta);
}

/**
 * Underlines the suggestions in the text (decorations: never saved) and opens
 * one when it is clicked. A suggestion whose words were edited goes away.
 */
export const Proofreading = Extension.create<{ onOpen: (id: string | null) => void }>({
  name: "somnusProofreading",
  addOptions() {
    return { onOpen: () => undefined };
  },
  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    return [
      new Plugin<ProofState>({
        key: proofKey,
        state: {
          init: () => ({ items: [], active: null }),
          apply: (tr, value, _old, next) => {
            const meta = tr.getMeta(proofKey) as ProofMeta | undefined;
            let items = value.items;
            let active = value.active;
            if (tr.docChanged) {
              items = items
                .map((item) => ({
                  ...item,
                  from: tr.mapping.map(item.from, 1),
                  to: tr.mapping.map(item.to, -1),
                }))
                .filter(
                  (item) =>
                    item.to > item.from &&
                    next.doc.textBetween(item.from, item.to, "\n", " ") === item.original,
                );
            }
            if (meta?.kind === "set") items = meta.items;
            if (meta?.kind === "remove")
              items = items.filter((item) => !meta.ids.includes(item.id));
            if (meta?.kind === "active") active = meta.id;
            if (active && !items.some((item) => item.id === active)) active = null;
            return { items, active };
          },
        },
        props: {
          decorations(state) {
            const { items, active } = suggestionsOf(state);
            if (items.length === 0) return null;
            return DecorationSet.create(
              state.doc,
              items.map((item) =>
                Decoration.inline(item.from, item.to, {
                  class:
                    item.id === active ? "somnus-suggest somnus-suggest-active" : "somnus-suggest",
                  "data-suggest": item.id,
                }),
              ),
            );
          },
          handleClick(view, pos) {
            const hit = suggestionsOf(view.state).items.find((i) => pos >= i.from && pos <= i.to);
            onOpen(hit?.id ?? null);
            return false;
          },
        },
      }),
    ];
  },
});

/** Proofreads the whole document, a request at a time, into suggestions. */
export async function proofreadDocument(
  doc: PmNode,
  lang: DriveSpeechLang,
  ask: (text: string, lang: DriveSpeechLang) => Promise<DriveProofreadResult>,
  onProgress: (done: number, total: number) => void,
): Promise<Suggestion[]> {
  const chunks = chunksOf(doc);
  const found: Suggestion[][] = chunks.map(() => []);
  let next = 0;
  let done = 0;
  onProgress(0, chunks.length);
  // Three requests at a time: quick for a long document, gentle on the quota.
  const lane = async () => {
    while (next < chunks.length) {
      const index = next++;
      const chunk = chunks[index] as Chunk;
      found[index] = placeSuggestions(doc, chunk, await ask(chunk.text, lang));
      done += 1;
      onProgress(Math.min(done, chunks.length - 1), chunks.length);
    }
  };
  await Promise.all([lane(), lane(), lane()]);
  onProgress(chunks.length, chunks.length);
  return found.flat();
}
