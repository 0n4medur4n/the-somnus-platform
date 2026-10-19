import type { JSONContent } from "@tiptap/core";
import { generateJSON } from "@tiptap/core";
import { documentExtensions } from "./doc-format.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** True for a Word document, by its type or, failing that, its name. */
export function isDocx(mime: string | undefined, name: string | undefined): boolean {
  return mime === DOCX_MIME || (name ?? "").toLowerCase().endsWith(".docx");
}

/**
 * A .docx as HTML, converted in this browser from the bytes already decrypted
 * here. Images are dropped (a preview of a protocol needs its words; embedding
 * arbitrary images would mean data URLs of unknown content), and the converter
 * is told never to read anything outside the file.
 *
 * The HTML is shown only inside a sandboxed frame with no scripts, and becomes
 * a document only through the editor's schema, which keeps nothing it does not
 * know -- so whatever the file contains, it cannot run.
 */
export async function docxToHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const convert = (mammoth as unknown as { default?: typeof mammoth }).default ?? mammoth;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // The browser build reads `arrayBuffer`; the Node build (tests) reads `buffer`.
  const input = { arrayBuffer: buffer as ArrayBuffer, buffer } as { arrayBuffer: ArrayBuffer };
  const result = await convert.convertToHtml(input, {
    externalFileAccess: false,
    convertImage: convert.images.imgElement(async () => ({ src: "" })),
  });
  return result.value;
}

/** A .docx as editor content: what the editor's schema can keep, and nothing else. */
export async function docxToDocument(bytes: Uint8Array): Promise<JSONContent> {
  const html = await docxToHtml(bytes);
  return generateJSON(html, documentExtensions());
}

/** A page for the sandboxed preview frame: the converted document, readable. */
export function previewPage(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
body{font-family:Georgia,"Times New Roman",serif;max-width:46rem;margin:2.5rem auto;padding:0 1.5rem;line-height:1.6;color:#111;background:#fff}
h1,h2,h3{font-family:Arial,Helvetica,sans-serif;line-height:1.25}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:.4rem .6rem;vertical-align:top}
img{display:none}
</style></head><body>${html}</body></html>`;
}
