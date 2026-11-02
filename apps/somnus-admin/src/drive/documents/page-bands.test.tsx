import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { contentFingerprint, documentCode } from "./doc-code.js";
import { cleanExtras, decodeDocument, encodeDocument } from "./doc-format.js";
import { safeImageSrc } from "./doc-image.js";
import { newLock, seal, unseal } from "./doc-lock.js";
import {
  bandHeight,
  exportDocument,
  type PageDress,
  pictureOf,
  stampOf,
  toDocx,
  toHtml,
  toPdf,
} from "./export.js";

const t = i18n.t.bind(i18n);

/** A 1×1 PNG. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const TEXT: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Cuerpo del acuerdo" }] }],
};
const HEADER: JSONContent = {
  type: "doc",
  content: [
    {
      type: "image",
      attrs: { src: PNG, alt: "Logo", width: 30, align: "left", naturalWidth: 1, naturalHeight: 1 },
    },
    { type: "paragraph", content: [{ type: "text", text: "Encabezado Somnus" }] },
  ],
};
const FOOTER: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Pie confidencial" }] }],
};
const LABELS = { code: "Código", fingerprint: "Huella", page: "Página" };
const DRESS: PageDress = {
  header: HEADER,
  footer: FOOTER,
  pageNumbers: true,
  code: "SMN-0000-1111-2222-3333",
  fingerprint: "AAAA-BBBB-CCCC-DDDD",
  labels: LABELS,
};

/** One file of a zip (a .docx), read through its central directory. */
async function zipEntry(bytes: Uint8Array, name: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 46 < bytes.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const method = view.getUint16(i + 10, true);
    const size = view.getUint32(i + 20, true);
    const nameLength = view.getUint16(i + 28, true);
    const entry = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + nameLength));
    if (entry !== name) continue;
    const local = view.getUint32(i + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.slice(start, start + size);
    if (method === 0) return new TextDecoder().decode(data);
    const stream = new Response(data).body?.pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }
  return null;
}

describe("a document's unique code (owner decision 2026-11-02)", () => {
  it("is SMN and four groups of the SHA-256 of the file, the same every time", async () => {
    const code = await documentCode("file-1");
    expect(code).toMatch(/^SMN-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(await documentCode("file-1")).toBe(code);
    expect(await documentCode("file-2")).not.toBe(code);
  });

  it("fingerprints exactly the contents: a changed word changes it", async () => {
    const one = await contentFingerprint({ title: "A", content: TEXT });
    expect(one).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(await contentFingerprint({ title: "A", content: TEXT })).toBe(one);
    expect(await contentFingerprint({ title: "A", content: FOOTER })).not.toBe(one);
  });

  it("is stamped as code and fingerprint, or not at all without a code", () => {
    expect(stampOf(DRESS)).toBe("Código SMN-0000-1111-2222-3333 · Huella AAAA-BBBB-CCCC-DDDD");
    expect(stampOf({ labels: LABELS })).toBe("");
    expect(stampOf(undefined)).toBe("");
  });
});

describe("headers, footers and page numbers in the stored document", () => {
  it("round-trip with the text, and a document without them reads as before", () => {
    const back = decodeDocument(encodeDocument(TEXT, { header: HEADER, pageNumbers: true }));
    expect(back.content).toEqual(TEXT);
    expect(cleanExtras(back)).toEqual({ header: HEADER, pageNumbers: true });
    expect(cleanExtras(decodeDocument(encodeDocument(TEXT)))).toEqual({});
  });

  it("keeps only bands that are documents and a true numbering flag", () => {
    expect(cleanExtras({ header: "<b>x</b>", footer: { type: "p" }, pageNumbers: "yes" })).toEqual(
      {},
    );
    expect(cleanExtras(undefined)).toEqual({});
  });

  it("are sealed with the text behind a password; older sealed documents still open", async () => {
    const lock = await newLock("contraseña-larga");
    const body = await seal({ content: TEXT, footer: FOOTER, pageNumbers: true }, lock);
    expect(JSON.stringify(body)).not.toContain("confidencial");
    const opened = await unseal(body, "contraseña-larga");
    expect(opened.content).toEqual(TEXT);
    expect(cleanExtras(opened.extras)).toEqual({ footer: FOOTER, pageNumbers: true });

    const legacy = await unseal(await seal(TEXT, opened.lock), "contraseña-larga");
    expect(legacy.content).toEqual(TEXT);
    expect(legacy.extras).toEqual({});
  }, 30_000);
});

describe("pictures", () => {
  it("are embedded images only; anything that could be fetched is dropped", () => {
    expect(safeImageSrc(PNG)).toBe(PNG);
    expect(safeImageSrc("https://example.org/x.png")).toBeNull();
    expect(safeImageSrc("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(pictureOf({ type: "image", attrs: { src: "https://example.org/x.png" } })).toBeNull();
    const picture = pictureOf(HEADER.content?.[0] ?? {});
    expect(picture).toMatchObject({ type: "png", width: 30, ratio: 1, align: "left" });
    expect(picture?.bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it("give a band the height they print at", () => {
    // 30 % of 483 pt, square, plus a line of text.
    expect(bandHeight(HEADER)).toBeCloseTo((483 * 30) / 100 + 8 + 14);
    expect(bandHeight(undefined)).toBe(0);
  });
});

describe("headers, footers and the code in exports", () => {
  it("frame an HTML page, the stamp escaped", () => {
    const html = toHtml(TEXT, "Acuerdo", "es", "", DRESS);
    expect(html).toContain('<header class="page-header">');
    expect(html).toContain("Encabezado Somnus");
    expect(html).toContain("Pie confidencial");
    expect(html).toContain("Código SMN-0000-1111-2222-3333 · Huella AAAA-BBBB-CCCC-DDDD");
    expect(toHtml(TEXT, "Acuerdo")).not.toContain('<header class="page-header">');
  });

  it("repeat in Word on every page, with the code and a page number field", async () => {
    const bytes = new Uint8Array(
      await (await toDocx(TEXT, "Acuerdo", { page: DRESS })).arrayBuffer(),
    );
    const header = await zipEntry(bytes, "word/header1.xml");
    const footer = await zipEntry(bytes, "word/footer1.xml");
    expect(header).toContain("Encabezado Somnus");
    expect(header).toContain("<pic:pic");
    expect(footer).toContain("Pie confidencial");
    expect(footer).toContain("SMN-0000-1111-2222-3333");
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");

    const plain = new Uint8Array(await (await toDocx(TEXT, "Acuerdo")).arrayBuffer());
    expect(await zipEntry(plain, "word/header1.xml")).toBeNull();
  });

  it("make a PDF with room for them", async () => {
    const bytes = new Uint8Array(
      await (await toPdf(TEXT, "Acuerdo", { page: DRESS })).arrayBuffer(),
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  }, 30_000);

  it("end Markdown and text with the bands and a fresh fingerprint of what went out", async () => {
    const page = { ...DRESS, fingerprint: undefined };
    const md = await (await exportDocument("md", TEXT, "Acuerdo", "es", { page })).text();
    const fingerprint = await contentFingerprint({
      title: "Acuerdo",
      content: TEXT,
      header: HEADER,
      footer: FOOTER,
    });
    expect(md.indexOf("Encabezado Somnus")).toBeLessThan(md.indexOf("# Acuerdo"));
    expect(md).toContain("Pie confidencial");
    expect(md.trimEnd().endsWith(`Huella ${fingerprint}`)).toBe(true);

    const txt = await (await exportDocument("txt", TEXT, "Acuerdo", "es", { page })).text();
    expect(txt).toContain("Cuerpo del acuerdo");
    expect(txt).toContain(`Código SMN-0000-1111-2222-3333 · Huella ${fingerprint}`);
    // Without a dress, as before.
    expect(await (await exportDocument("txt", TEXT, "Acuerdo", "es")).text()).toBe(
      "Cuerpo del acuerdo\n",
    );
  });
});

describe("headers, footers and the code in the editor", () => {
  it("shows the document's code, copies it, and saves the page numbering with the text", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue("saved");
    renderWithProviders(
      <DocumentEditor
        initialTitle="Acuerdo"
        initialContent={TEXT}
        initialExtras={{ header: HEADER }}
        documentId="file-1"
        readOnly={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    const code = await documentCode("file-1");
    const badge = await screen.findByRole("button", {
      name: `${t("drive.doc.code.copy")}: ${code}`,
    });
    expect(screen.getByText(`${t("drive.doc.code.label")} ${code}`)).toBeVisible();
    expect(screen.getByText("Encabezado Somnus")).toBeVisible();
    expect(screen.getByRole("group", { name: t("drive.doc.bands.footer") })).toBeInTheDocument();
    // Opening it changed nothing: there is nothing to save yet.
    expect(screen.getByRole("button", { name: t("drive.doc.save") })).toBeDisabled();

    await user.click(badge);
    expect(await navigator.clipboard.readText()).toBe(code);
    expect(screen.getByText(t("drive.doc.code.copied"))).toBeVisible();

    await user.click(screen.getByLabelText(t("drive.doc.bands.numberPages")));
    expect(screen.getByText(t("drive.doc.bands.pageSample"))).toBeVisible();
    await user.click(screen.getByRole("button", { name: t("drive.doc.save") }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[2]).toEqual({ header: HEADER, pageNumbers: true });
  });

  it("shows no empty bands to someone who can only read", () => {
    renderWithProviders(
      <DocumentEditor
        initialTitle="Acuerdo"
        initialContent={TEXT}
        initialExtras={{ footer: FOOTER }}
        readOnly
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group", { name: t("drive.doc.bands.header") })).toBeNull();
    expect(screen.getByText("Pie confidencial")).toBeVisible();
    expect(screen.queryByLabelText(t("drive.doc.bands.numberPages"))).toBeNull();
  });
});
