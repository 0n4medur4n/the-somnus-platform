import type { Extensions, JSONContent } from "@tiptap/core";
import { Blockquote } from "@tiptap/extension-blockquote";
import { Bold } from "@tiptap/extension-bold";
import { Code } from "@tiptap/extension-code";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Document } from "@tiptap/extension-document";
import { HardBreak } from "@tiptap/extension-hard-break";
import { Heading } from "@tiptap/extension-heading";
import { Highlight } from "@tiptap/extension-highlight";
import { HorizontalRule } from "@tiptap/extension-horizontal-rule";
import { Italic } from "@tiptap/extension-italic";
import { ListKit } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Strike } from "@tiptap/extension-strike";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import { Text } from "@tiptap/extension-text";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { Dropcursor, Gapcursor, TrailingNode, UndoRedo } from "@tiptap/extensions";
import { SomnusImage } from "./doc-image.js";
import { type LockedBody, lockedBodyOf } from "./doc-lock.js";
import { SomnusLink } from "./link-mark.js";

/**
 * A Drive document (owner decision 2026-10-19): a rich-text page written in the
 * console, stored in the Drive exactly like any other file -- encrypted in the
 * browser, block by block, before anything is sent. Its bytes are this JSON;
 * the type below is what tells the Drive to open it in the editor.
 */
export const DOCUMENT_MIME = "application/vnd.somnus.document+json";

/**
 * What a page carries besides its text (owner decision 2026-11-02): a header
 * and a footer, written like the document, and whether pages are numbered.
 * Optional: a document without them reads as it always did.
 */
export type DocExtras = {
  header?: JSONContent | undefined;
  footer?: JSONContent | undefined;
  pageNumbers?: boolean | undefined;
};

export type SomnusDocument = {
  format: "somnus-document";
  version: 1;
  content: JSONContent;
} & DocExtras;

/** The extras as stored: only bands that are documents, and a boolean. */
export function cleanExtras(
  value: { header?: unknown; footer?: unknown; pageNumbers?: unknown } | undefined,
): DocExtras {
  const band = (v: unknown) =>
    v && typeof v === "object" && (v as JSONContent).type === "doc"
      ? (v as JSONContent)
      : undefined;
  const header = band(value?.header);
  const footer = band(value?.footer);
  return {
    ...(header ? { header } : {}),
    ...(footer ? { footer } : {}),
    ...(value?.pageNumbers === true ? { pageNumbers: true } : {}),
  };
}

/** A document with its own password: the text is sealed, see doc-lock.ts. */
export type LockedDocument = {
  format: "somnus-document";
  version: 1;
  locked: LockedBody;
};

/**
 * The fonts a document can use: ours first (Satoshi, the brand's text face, and
 * Okine for display, both served by the console), then ones every computer has.
 * The first is what a document is written in unless a passage says otherwise.
 */
export const DOC_FONTS = [
  { name: "Satoshi", css: "Satoshi, Arial, sans-serif", brand: true },
  { name: "Okine", css: "Okine, Satoshi, Arial, sans-serif", brand: true },
  { name: "Arial", css: "Arial, Helvetica, sans-serif", brand: false },
  { name: "Calibri", css: "Calibri, Carlito, Arial, sans-serif", brand: false },
  { name: "Georgia", css: "Georgia, serif", brand: false },
  { name: "Times New Roman", css: '"Times New Roman", Times, serif', brand: false },
  { name: "Verdana", css: "Verdana, sans-serif", brand: false },
  { name: "Courier New", css: '"Courier New", monospace', brand: false },
] as const;
export const DEFAULT_FONT = "Satoshi";
/** Point sizes offered, as in a word processor; text without one is 11 pt. */
export const DOC_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72] as const;
export const DEFAULT_FONT_SIZE = 11;
/** The text colours and highlighter colours offered (a passage keeps any valid one it has). */
export const TEXT_COLORS = [
  "#000000",
  "#434343",
  "#666666",
  "#999999",
  "#cc0000",
  "#e69138",
  "#f1c232",
  "#6aa84f",
  "#45818e",
  "#3c78d8",
  "#3d85c6",
  "#674ea7",
  "#a64d79",
  "#437ef7",
] as const;
export const HIGHLIGHT_COLORS = [
  "#fff2a8",
  "#ffe599",
  "#b6d7a8",
  "#a2c4c9",
  "#9fc5e8",
  "#b4a7d6",
  "#ead1dc",
  "#f4cccc",
] as const;

/** The family name a font-family value starts with, without quotes. */
export function fontNameOf(css: unknown): string | null {
  if (typeof css !== "string") return null;
  const first = css
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return first ? first : null;
}

/** A size such as "14pt" as a number of points, or null. */
export function pointsOf(css: unknown): number | null {
  if (typeof css !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)pt$/.exec(css.trim());
  const value = match ? Number(match[1]) : Number.NaN;
  return value >= 1 && value <= 400 ? value : null;
}

/** A #rrggbb colour, lower case, or null for anything else. */
export function hexOf(css: unknown): string | null {
  if (typeof css !== "string") return null;
  const value = css.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (/^#[0-9a-f]{3}$/.test(value)) return `#${[...value.slice(1)].map((c) => c + c).join("")}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(value);
  if (!rgb) return null;
  const parts = rgb.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

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
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
    Highlight.configure({ multicolor: true }),
    Subscript,
    Superscript,
    TableKit.configure({ table: { resizable: false } }),
    SomnusImage,
  ];
}

export function emptyDocument(): SomnusDocument {
  return { format: "somnus-document", version: 1, content: { type: "doc", content: [] } };
}

export function encodeDocument(content: JSONContent, extras: DocExtras = {}): Uint8Array {
  const document: SomnusDocument = {
    format: "somnus-document",
    version: 1,
    content,
    ...cleanExtras(extras),
  };
  return new TextEncoder().encode(JSON.stringify(document));
}

export function encodeLockedDocument(locked: LockedBody): Uint8Array {
  const document: LockedDocument = { format: "somnus-document", version: 1, locked };
  return new TextEncoder().encode(JSON.stringify(document));
}

/** The sealed body when the bytes are a document with its own password. */
export function lockedOf(bytes: Uint8Array): LockedBody | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LockedDocument>;
    return parsed.format === "somnus-document" ? lockedBodyOf(parsed.locked) : null;
  } catch {
    return null;
  }
}

/**
 * The stored document, or an empty one when the bytes are not a document. A
 * document with its own password reads as empty here: check `lockedOf` first.
 */
export function decodeDocument(bytes: Uint8Array): SomnusDocument {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SomnusDocument>;
    if (parsed.format === "somnus-document" && parsed.content?.type === "doc") {
      return {
        format: "somnus-document",
        version: 1,
        content: parsed.content,
        ...cleanExtras(parsed),
      };
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
