import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import CFB from "cfb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { FONT_FILES } from "./doc-fonts.js";
import {
  documentExtensions,
  encodeLockedDocument,
  fontNameOf,
  hexOf,
  lockedOf,
  pointsOf,
} from "./doc-format.js";
import { lockedBodyOf, newLock, seal, unseal, WrongPasswordError } from "./doc-lock.js";
import { fontFaces, fontsUsed, toDocx, toHtml, toMarkdown, toPdf, toText } from "./export.js";
import { encryptOfficeFile } from "./office-crypto.js";
import { sha512Sync } from "./sha512.js";

const t = i18n.t.bind(i18n);

/** A document using every new tool (owner request 2026-11-02). */
const STYLED: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Rojo",
          marks: [
            {
              type: "textStyle",
              attrs: {
                color: "#cc0000",
                fontFamily: "Okine, Satoshi, Arial, sans-serif",
                fontSize: "18pt",
              },
            },
          ],
        },
        {
          type: "text",
          text: " resaltado",
          marks: [{ type: "highlight", attrs: { color: "#b6d7a8" } }],
        },
        { type: "text", text: " H" },
        { type: "text", text: "2", marks: [{ type: "subscript" }] },
        { type: "text", text: "O m" },
        { type: "text", text: "2", marks: [{ type: "superscript" }] },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hecho" }] }],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Pendiente" }] }],
        },
      ],
    },
  ],
};

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("styles in documents", () => {
  it("reads colours, fonts and sizes only in the forms it writes", () => {
    expect(hexOf("#ABC")).toBe("#aabbcc");
    expect(hexOf("rgb(204, 0, 0)")).toBe("#cc0000");
    expect(hexOf("red")).toBeNull();
    expect(hexOf("rgb(300, 0, 0)")).toBeNull();
    expect(fontNameOf('"Times New Roman", serif')).toBe("Times New Roman");
    expect(fontNameOf(42)).toBeNull();
    expect(pointsOf("14pt")).toBe(14);
    expect(pointsOf("14px")).toBeNull();
    expect(pointsOf("0pt")).toBeNull();
  });

  it("keeps every new mark when the editor reads a document back", () => {
    const editor = new Editor({ extensions: documentExtensions(), content: STYLED });
    const html = editor.getHTML();
    editor.destroy();
    expect(html).toContain("color: rgb(204, 0, 0)");
    expect(html).toContain("font-size: 18pt");
    expect(html).toContain('data-color="#b6d7a8"');
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
    expect(html).toContain('data-type="taskList"');
  });

  it("knows which of our fonts a document needs, Satoshi always", () => {
    expect([...fontsUsed(STYLED)].sort()).toEqual(["Okine", "Satoshi"]);
    expect([...fontsUsed({ type: "doc", content: [] })]).toEqual(["Satoshi"]);
  });

  it("exports tick boxes in text and Markdown, and styles in HTML", () => {
    expect(toText(STYLED)).toContain("☑ Hecho");
    expect(toText(STYLED)).toContain("☐ Pendiente");
    expect(toMarkdown(STYLED, "T")).toContain("- [x] Hecho\n\n- [ ] Pendiente");
    const html = toHtml(STYLED, "T", "es", "@font-face{x}");
    expect(html).toContain("@font-face{x}");
    expect(html).toContain("font-family:Satoshi");
    expect(html).toContain("color: rgb(204, 0, 0)");
  });

  it("writes colour, highlight, font, size and sub/superscript into Word", async () => {
    // The container library reads zips too.
    const zip = CFB.read(await bytesOf(await toDocx(STYLED, "Estilos")), { type: "array" });
    const part = (path: string) =>
      new TextDecoder().decode(
        Uint8Array.from(CFB.find(zip, `/${path}`)?.content as ArrayLike<number>),
      );
    const xml = part("word/document.xml");
    const styles = part("word/styles.xml");
    expect(xml).toContain('w:color w:val="cc0000"');
    expect(xml).toContain('w:fill="b6d7a8"');
    expect(xml).toContain('w:ascii="Okine"');
    expect(xml).toContain('w:sz w:val="36"');
    expect(xml).toContain('w:vertAlign w:val="subscript"');
    expect(xml).toContain('w:vertAlign w:val="superscript"');
    expect(xml).toContain("☑");
    expect(styles).toContain('w:ascii="Satoshi"');
  });
});

describe("passwords on exported files", () => {
  it("computes SHA-512 exactly as WebCrypto does, for every padding case", async () => {
    for (const length of [0, 3, 68, 111, 112, 127, 128, 129, 300]) {
      const message = crypto.getRandomValues(new Uint8Array(length));
      const expected = new Uint8Array(await crypto.subtle.digest("SHA-512", message));
      expect(sha512Sync(message)).toEqual(expected);
    }
  });

  /** AES-CBC without padding, undone with WebCrypto: a valid padding block is appended. */
  async function cbcDecrypt(raw: Uint8Array, iv: Uint8Array, data: Uint8Array) {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(raw), "AES-CBC", false, [
      "encrypt",
      "decrypt",
    ]);
    const last = new Uint8Array(data.slice(-16));
    const pad = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-CBC", iv: last }, key, new Uint8Array(0)),
    );
    const joined = new Uint8Array([...data, ...pad]);
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(iv) }, key, joined),
    );
  }

  async function sha(...parts: number[][]) {
    return new Uint8Array(await crypto.subtle.digest("SHA-512", new Uint8Array(parts.flat())));
  }

  it("wraps a Word file the way Office does, opening only with its password", async () => {
    const plain = crypto.getRandomValues(new Uint8Array(10_000));
    const password = "Guardia-2026 ñ";
    const file = await encryptOfficeFile(plain, password);
    const container = CFB.read(file, { type: "array" });
    const stream = (path: string) =>
      Uint8Array.from(CFB.find(container, path)?.content as ArrayLike<number>);
    expect(
      CFB.find(
        container,
        "/\u0006DataSpaces/TransformInfo/StrongEncryptionTransform/\u0006Primary",
      ),
    ).toBeTruthy();

    const info = stream("/EncryptionInfo");
    expect([...info.slice(0, 8)]).toEqual([4, 0, 4, 0, 0x40, 0, 0, 0]);
    const xml = new DOMParser().parseFromString(
      new TextDecoder().decode(info.slice(8)),
      "application/xml",
    );
    const keyData = xml.getElementsByTagName("keyData")[0];
    const encryptedKey = xml.getElementsByTagName("p:encryptedKey")[0];
    if (!keyData || !encryptedKey) throw new Error("no key data");
    const b64 = (value: string | null) => [...atob(value ?? "")].map((c) => c.charCodeAt(0));
    expect(encryptedKey.getAttribute("spinCount")).toBe("100000");

    // The password's key, as Office derives it.
    const salt = b64(encryptedKey.getAttribute("saltValue"));
    const utf16 = [...password].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]);
    let hash: Uint8Array = await sha(salt, utf16);
    for (let i = 0; i < 100_000; i++) {
      hash = sha512Sync(new Uint8Array([i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff, 0, ...hash]));
    }
    const keyFor = async (block: number[]) => (await sha([...hash], block)).slice(0, 32);
    const ivSalt = new Uint8Array(salt);

    // What Office checks to accept a password: the verifier and its hash agree.
    const input = await cbcDecrypt(
      await keyFor([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]),
      ivSalt,
      new Uint8Array(b64(encryptedKey.getAttribute("encryptedVerifierHashInput"))),
    );
    const value = await cbcDecrypt(
      await keyFor([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]),
      ivSalt,
      new Uint8Array(b64(encryptedKey.getAttribute("encryptedVerifierHashValue"))),
    );
    expect(value).toEqual(await sha([...input]));

    // And the package decrypts back to the original file.
    const secret = await cbcDecrypt(
      await keyFor([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]),
      ivSalt,
      new Uint8Array(b64(encryptedKey.getAttribute("encryptedKeyValue"))),
    );
    const packageBytes = stream("/EncryptedPackage");
    const size = Number(new DataView(packageBytes.buffer).getBigUint64(0, true));
    expect(size).toBe(plain.length);
    const keySalt = b64(keyData.getAttribute("saltValue"));
    const out: number[] = [];
    for (let at = 8, index = 0; at < packageBytes.length; at += 4096, index++) {
      const iv = (await sha(keySalt, [index & 0xff, index >> 8, 0, 0])).slice(0, 16);
      out.push(...(await cbcDecrypt(secret, iv, packageBytes.slice(at, at + 4096))));
    }
    expect(new Uint8Array(out.slice(0, size))).toEqual(plain);

    // A wrong password gives a verifier that does not agree.
    let wrong: Uint8Array = await sha(salt, [0x6d, 0, 0x61, 0, 0x6c, 0]);
    for (let i = 0; i < 100_000; i++) {
      wrong = sha512Sync(
        new Uint8Array([i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff, 0, ...wrong]),
      );
    }
    const wrongKey = (
      await sha([...wrong], [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e])
    ).slice(0, 32);
    const wrongValue = await cbcDecrypt(
      wrongKey,
      ivSalt,
      new Uint8Array(b64(encryptedKey.getAttribute("encryptedVerifierHashValue"))),
    );
    expect(wrongValue).not.toEqual(value);
  }, 60_000);

  it("exports a Word file with a password as an Office container, not a zip", async () => {
    const bytes = await bytesOf(await toDocx(STYLED, "Con clave", { password: "una-clave-larga" }));
    expect([...bytes.slice(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  }, 30_000);

  it("exports a PDF with a password, encrypted with AES-256", async () => {
    const plain = await bytesOf(await toPdf(STYLED, "Sin clave"));
    const locked = await bytesOf(await toPdf(STYLED, "Con clave", { password: "una-clave-larga" }));
    const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
    expect(text(plain)).not.toContain("/Encrypt");
    expect(text(locked)).toContain("/Encrypt");
    expect(text(locked)).toMatch(/\/V 5/);
    expect(text(locked)).not.toContain("Con clave");
  }, 30_000);
});

describe("our fonts in exports", () => {
  it("embeds Satoshi and Okine in a PDF, from the files the console serves", async () => {
    const { readFile } = await import("node:fs/promises");
    const fonts = new Map<string, Uint8Array>();
    for (const files of Object.values(FONT_FILES)) {
      for (const path of Object.values(files)) {
        fonts.set(path, new Uint8Array(await readFile(`public${path}`)));
      }
    }
    const text = new TextDecoder("latin1").decode(
      await bytesOf(await toPdf(STYLED, "Fuentes", { fonts })),
    );
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Satoshi/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+MADEOkine/);
  }, 30_000);

  it("falls back to the PDF writer's own font when ours cannot be read", async () => {
    const text = new TextDecoder("latin1").decode(
      await bytesOf(await toPdf(STYLED, "Sin fuentes")),
    );
    expect(text).toContain("Roboto");
    expect(text).not.toContain("Satoshi");
  }, 30_000);

  it("carries our fonts inside an exported HTML page", () => {
    const faces = fontFaces(new Map([[FONT_FILES.Satoshi.normal, new Uint8Array([1, 2, 3])]]));
    expect(faces).toBe(
      '@font-face{font-family:"Satoshi";src:url(data:font/otf;base64,AQID) format("opentype");font-weight:400;font-style:normal}',
    );
  });
});

describe("a document's own password", () => {
  it("seals the text so only the password opens it, and refuses a wrong one", async () => {
    const lock = await newLock("contraseña-larga");
    const body = await seal(STYLED, lock);
    expect(JSON.stringify(body)).not.toContain("Rojo");
    const stored = encodeLockedDocument(body);
    expect(lockedOf(stored)).toEqual(body);
    expect(
      lockedOf(new TextEncoder().encode('{"format":"somnus-document","version":1,"content":{}}')),
    ).toBeNull();

    const opened = await unseal(body, "contraseña-larga");
    expect(opened.content).toEqual(STYLED);
    // The same lock seals again with a fresh IV.
    const again = await seal(STYLED, opened.lock);
    expect(again.iv).not.toBe(body.iv);
    expect((await unseal(again, "contraseña-larga")).content).toEqual(STYLED);

    await expect(unseal(body, "otra-contraseña")).rejects.toBeInstanceOf(WrongPasswordError);
  }, 30_000);

  it("refuses stored locks with weak or odd parameters", () => {
    const good = { kdf: "PBKDF2-SHA256", iterations: 600_000, salt: "a", iv: "b", data: "c" };
    expect(lockedBodyOf(good)).toEqual(good);
    expect(lockedBodyOf({ ...good, iterations: 1000 })).toBeNull();
    expect(lockedBodyOf({ ...good, kdf: "none" })).toBeNull();
    expect(lockedBodyOf({ ...good, data: 1 })).toBeNull();
    expect(lockedBodyOf(null)).toBeNull();
  });
});

describe("the toolbar and passwords in the editor", () => {
  it("offers our fonts first, sizes, colours and the new list tools", () => {
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{ type: "doc", content: [] }}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const font = screen.getByLabelText(t("drive.doc.tools.font")) as HTMLSelectElement;
    expect(font.value).toBe("Satoshi");
    expect([...font.options].slice(0, 2).map((o) => o.value)).toEqual(["Satoshi", "Okine"]);
    expect((screen.getByLabelText(t("drive.doc.tools.size")) as HTMLSelectElement).value).toBe(
      "11",
    );
    for (const name of [
      "drive.doc.tools.color",
      "drive.doc.tools.highlight",
      "drive.doc.tools.subscript",
      "drive.doc.tools.superscript",
      "drive.doc.tools.clear",
      "drive.doc.tools.taskList",
      "drive.doc.tools.indent",
    ]) {
      expect(screen.getByRole("button", { name: t(name) })).toBeInTheDocument();
    }
  });

  it("asks for a new password twice before protecting the document, then saves", async () => {
    const user = userEvent.setup();
    const set = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn().mockResolvedValue("saved");
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{ type: "doc", content: [] }}
        readOnly={false}
        onSave={onSave}
        onClose={vi.fn()}
        password={{ locked: false, set }}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("drive.doc.password.menu") }));
    await user.click(screen.getByRole("menuitem", { name: t("drive.doc.password.add") }));
    await user.type(screen.getByLabelText(t("drive.doc.password.new")), "corta");
    await user.type(screen.getByLabelText(t("drive.doc.password.repeat")), "corta");
    await user.click(screen.getByRole("button", { name: t("drive.doc.password.apply") }));
    expect(screen.getByText(t("drive.doc.password.tooShort", { count: 8 }))).toBeVisible();

    await user.clear(screen.getByLabelText(t("drive.doc.password.new")));
    await user.type(screen.getByLabelText(t("drive.doc.password.new")), "larga-clave-1");
    await user.clear(screen.getByLabelText(t("drive.doc.password.repeat")));
    await user.type(screen.getByLabelText(t("drive.doc.password.repeat")), "larga-clave-2");
    await user.click(screen.getByRole("button", { name: t("drive.doc.password.apply") }));
    expect(screen.getByText(t("drive.doc.password.mismatch"))).toBeVisible();

    await user.clear(screen.getByLabelText(t("drive.doc.password.repeat")));
    await user.type(screen.getByLabelText(t("drive.doc.password.repeat")), "larga-clave-1");
    await user.click(screen.getByRole("button", { name: t("drive.doc.password.apply") }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith("larga-clave-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Word and PDF with a password in the export menu", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{ type: "doc", content: [] }}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("drive.doc.export.title") }));
    expect(
      screen.getByRole("menuitem", { name: t("drive.doc.export.docxPassword") }),
    ).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: t("drive.doc.export.pdfPassword") }));
    expect(screen.getByRole("dialog", { name: t("drive.doc.export.pdfPassword") })).toBeVisible();
    expect(screen.getByText(t("drive.doc.password.exportWarning"))).toBeVisible();
  });
});
