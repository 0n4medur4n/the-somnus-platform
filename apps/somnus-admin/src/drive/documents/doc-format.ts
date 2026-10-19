import type { Extensions, JSONContent } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Heading } from "@tiptap/extension-heading";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { Italic } from "@tiptap/extension-italic";
import { ListKit } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Strike } from "@tiptap/extension-strike";
import { TableKit } from "@tiptap/extension-table";
import { Text } from "@tiptap/extension-text";
import { TextAlign } from "@tiptap/extension-text-align";
import { Underline } from "@tiptap/extension-underline";
import { Dropcursor, Gapcursor, TrailingNode, UndoRedo } from "@tiptap/extensions";
import { SomnusLink } from "./link-mark.js";

/**
 * A Drive document (owner decision 2026-10-19): a rich-text page written in the
 * console, stored in the Drive exactly like any other file -- encrypted in the
 * browser, block by block, before anything is sent. Its bytes are this JSON;
 * the type below is what tells the Drive to open it in the editor.
 */
export const DOCUMENT_MIME = "application/vnd.somnus.document+json";

export type SomnusDocument = {
  format: "somnus-document";
  version: 1;
  content: JSONContent;
};

/** The editor's vocabulary. Every export and every import uses exactly this. */
export function documentExtensions(): Extensions {
  return [
    // Composed one by one rather than through StarterKit: StarterKit always
    // bundles TipTap's own link extension and its URL scanner, which we do not use.
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    CodeBlock,
    Blockquote,
    HorizontalRule,
    HardBreak,
    ListKit,
    Dropcursor,
    Gapcursor,
    TrailingNode,
    UndoRedo,
    SomnusLink,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableKit.configure({ table: { resizable: false } }),
  ];
}

export function emptyDocument(): SomnusDocument {
  return { format: "somnus-document", version: 1, content: { type: "doc", content: [] } };
}

export function encodeDocument(content: JSONContent): Uint8Array {
  const document: SomnusDocument = { format: "somnus-document", version: 1, content };
  return new TextEncoder().encode(JSON.stringify(document));
}

/** The stored document, or an empty one when the bytes are not a document. */
export function decodeDocument(bytes: Uint8Array): SomnusDocument {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SomnusDocument>;
    if (parsed.format === "somnus-document" && parsed.content?.type === "doc") {
      return { format: "somnus-document", version: 1, content: parsed.content };
    }
  } catch {
    // fall through
  }
  return emptyDocument();
}

/** A file name with `extension`, from a document title. */
export function fileNameFor(title: string, extension: string): string {
  const base = title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "documento";
  return `${base}.${extension}`;
}
