import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import { decodeDocument, emptyDocument, encodeDocument, fileNameFor } from "./doc-format.js";
import { toDocx, toHtml, toMarkdown, toPdf, toText } from "./export.js";
import { docxToDocument, isDocx, previewPage } from "./import-docx.js";

const DOC: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Protocolo" }] },
    {
      type: "paragraph",
      attrs: { textAlign: "justify" },
      content: [
        { type: "text", text: "Dormir " },
        { type: "text", text: "bien", marks: [{ type: "bold" }] },
        { type: "text", text: " importa. Ver " },
        {
          type: "text",
          text: "guía",
          marks: [{ type: "link", attrs: { href: "https://example.org/guia" } }],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Luz" }] }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Horario" }] }],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Hábito" }] }],
            },
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Veces" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Paseo" }] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }],
            },
          ],
        },
      ],
    },
  ],
};

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Drive documents (owner decision 2026-10-19). */
describe("drive documents", () => {
  it("round-trips through the stored format, and refuses to read anything else as one", () => {
    expect(decodeDocument(encodeDocument(DOC)).content).toEqual(DOC);
    expect(decodeDocument(new TextEncoder().encode("not json"))).toEqual(emptyDocument());
    expect(decodeDocument(new TextEncoder().encode('{"format":"other"}'))).toEqual(emptyDocument());
  });

  it("names exported files after the title, without path characters", () => {
    expect(fileNameFor("Guía: sueño / adultos", "pdf")).toBe("Guía  sueño   adultos.pdf");
    expect(fileNameFor("   ", "docx")).toBe("documento.docx");
  });

  it("exports plain text and Markdown with headings, emphasis, links, lists and tables", () => {
    const text = toText(DOC);
    expect(text).toContain("Protocolo");
    expect(text).toContain("• Luz");
    expect(text).toContain("Hábito\tVeces");

    const md = toMarkdown(DOC, "Guía");
    expect(md.startsWith("# Guía\n")).toBe(true);
    expect(md).toContain("## Protocolo");
    expect(md).toContain("**bien**");
    expect(md).toContain("[guía](https://example.org/guia)");
    expect(md).toContain("- Horario");
    expect(md).toContain("| Hábito | Veces |\n| --- | --- |\n| Paseo | 2 |");
  });

  it("exports a standalone, escaped HTML page", () => {
    const html = toHtml(DOC, "<Guía>", "es");
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<title>&#60;Guía&#62;</title>");
    expect(html).toContain("<strong>bien</strong>");
    expect(html).toContain('href="https://example.org/guia"');
  });

  it("exports a real Word file, which reads back with its words", async () => {
    const blob = await toDocx(DOC, "Guía");
    const bytes = await bytesOf(blob);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]); // a zip: "PK"

    const back = JSON.stringify(await docxToDocument(bytes));
    for (const word of ["Guía", "Protocolo", "bien", "Luz", "Hábito", "Paseo"]) {
      expect(back).toContain(word);
    }
  });

  it("exports a real PDF", async () => {
    const bytes = await bytesOf(await toPdf(DOC, "Guía"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  }, 30_000);

  it("recognises Word files by type or name, and previews them with nothing able to run", () => {
    expect(
      isDocx("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a"),
    ).toBe(true);
    expect(isDocx(undefined, "Informe.DOCX")).toBe(true);
    expect(isDocx("application/pdf", "a.pdf")).toBe(false);
    const page = previewPage("<p>hola</p>");
    expect(page).toContain("default-src 'none'");
    expect(page).toContain("<p>hola</p>");
  });
});
