import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { blockOf, type DriveNote, marksFor, normalizeQuote } from "./notes-format.js";

export const noteMarksKey = new PluginKey<DriveNote[]>("somnusNoteMarks");

export type DocBlock = { pos: number; size: number; text: string };

/** The document's readable blocks, in order: every text block with words in it. */
export function docBlocks(doc: PmNode): DocBlock[] {
  const blocks: DocBlock[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = normalizeQuote(node.textContent);
    if (text) blocks.push({ pos, size: node.nodeSize, text });
    return false;
  });
  return blocks;
}

/**
 * Highlights the blocks of a Drive document that have notes. These are editor
 * decorations, not content: they are not saved, and no export carries them.
 */
export const NoteMarks = Extension.create<{ onClickBlock: (index: number) => void }>({
  name: "somnusNoteMarks",

  addOptions() {
    return { onClickBlock: () => undefined };
  },

  addProseMirrorPlugins() {
    const { onClickBlock } = this.options;
    return [
      new Plugin<DriveNote[]>({
        key: noteMarksKey,
        state: {
          init: () => [],
          apply: (tr, notes) => (tr.getMeta(noteMarksKey) as DriveNote[] | undefined) ?? notes,
        },
        props: {
          decorations(state) {
            const notes = noteMarksKey.getState(state) ?? [];
            if (notes.length === 0) return DecorationSet.empty;
            const blocks = docBlocks(state.doc);
            const texts = blocks.map((block) => block.text);
            return DecorationSet.create(
              state.doc,
              marksFor(notes, texts).flatMap((mark) => {
                const block = blocks[mark.index];
                if (!block) return [];
                return [
                  Decoration.node(block.pos, block.pos + block.size, {
                    class: mark.done ? "somnus-noted somnus-done" : "somnus-noted",
                    "data-somnus-count": String(mark.count),
                  }),
                ];
              }),
            );
          },
          handleClick(view, pos) {
            const notes = noteMarksKey.getState(view.state) ?? [];
            const blocks = docBlocks(view.state.doc);
            const index = blocks.findIndex((b) => pos >= b.pos && pos < b.pos + b.size);
            const texts = blocks.map((block) => block.text);
            if (index >= 0 && notes.some((note) => blockOf(note, texts) === index)) {
              onClickBlock(index);
            }
            return false;
          },
        },
      }),
    ];
  },
});
