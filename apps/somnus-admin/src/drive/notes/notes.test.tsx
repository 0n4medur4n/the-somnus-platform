import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { previewPage } from "../documents/import-docx.js";
import { markdownPage } from "../documents/markdown.js";
import { FileViewer } from "../ui/FileViewer.js";
import { AnnotatedFrame } from "./AnnotatedFrame.js";
import { annotatedPage } from "./annotated-page.js";
import {
  blockOf,
  type DriveNote,
  decodeNotes,
  encodeNotes,
  marksFor,
  normalizeQuote,
  orderNotes,
} from "./notes-format.js";
import type { NotesBinding } from "./use-notes.js";

const t = i18n.t.bind(i18n);

const note = (over: Partial<DriveNote> = {}): DriveNote => ({
  id: "n1",
  authorId: "u1",
  text: "Revisar con Jesús",
  createdAt: "2026-11-01T10:00:00.000Z",
  done: false,
  anchor: { kind: "general" },
  ...over,
});

const onBlock = (quote: string, index: number, over: Partial<DriveNote> = {}) =>
  note({ anchor: { kind: "block", quote, index }, ...over });

describe("the stored notes", () => {
  it("round-trip", () => {
    const notes = [note(), onBlock("Pregunta 1", 3), note({ anchor: { kind: "page", page: 2 } })];
    expect(decodeNotes(encodeNotes(notes))).toEqual(notes);
  });

  it("are empty rather than broken when the bytes are something else", () => {
    expect(decodeNotes(new TextEncoder().encode("no es json"))).toEqual([]);
    expect(decodeNotes(new TextEncoder().encode('{"format":"otro","notes":[]}'))).toEqual([]);
  });

  it("drop whatever is not a note", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        format: "somnus-notes",
        version: 1,
        notes: [
          note(),
          null,
          { id: 1 },
          note({ anchor: { kind: "page", page: -1 } }),
          note({ anchor: { kind: "page", page: 1.5 } }),
          { ...note(), anchor: { kind: "block", index: 1 } },
          { ...note(), anchor: { kind: "desconocido" } },
        ],
      }),
    );
    expect(decodeNotes(bytes)).toEqual([note()]);
  });

  it("cap a note's length", () => {
    const bytes = encodeNotes([note({ text: "x".repeat(10_000) })]);
    expect(decodeNotes(bytes)[0]?.text).toHaveLength(4000);
  });
});

describe("placing notes", () => {
  const blocks = ["Título", "Pregunta 1: ¿edad?", "Pregunta 2: ¿sueño?"];

  it("finds a note where it was", () => {
    expect(blockOf(onBlock("Pregunta 1", 1), blocks)).toBe(1);
  });

  it("follows the text when it moved", () => {
    expect(blockOf(onBlock("Pregunta 2", 0), blocks)).toBe(2);
  });

  it("says so when the text is gone, instead of pinning it somewhere else", () => {
    expect(blockOf(onBlock("Pregunta 9", 1), blocks)).toBeNull();
  });

  it("does not place a note on a page or a general note", () => {
    expect(blockOf(note(), blocks)).toBeNull();
    expect(blockOf(note({ anchor: { kind: "page", page: 1 } }), blocks)).toBeNull();
  });

  it("counts a block's notes, resolved only if all of them are", () => {
    expect(
      marksFor(
        [
          onBlock("Pregunta 1", 1, { id: "a", done: true }),
          onBlock("Pregunta 1", 1, { id: "b" }),
          onBlock("Pregunta 2", 2, { id: "c", done: true }),
        ],
        blocks,
      ),
    ).toEqual([
      { index: 1, count: 2, done: false },
      { index: 2, count: 1, done: true },
    ]);
  });

  it("lists general notes first, then as they appear, then the lost ones", () => {
    const ordered = orderNotes(
      [
        onBlock("Pregunta 9", 0, { id: "lost" }),
        onBlock("Pregunta 2", 2, { id: "second" }),
        note({ id: "general" }),
        onBlock("Pregunta 1", 1, { id: "first" }),
      ],
      blocks,
    );
    expect(ordered.map((n) => n.id)).toEqual(["general", "first", "second", "lost"]);
  });

  it("orders notes on a PDF by page", () => {
    const ordered = orderNotes(
      [
        note({ id: "b", anchor: { kind: "page", page: 9 } }),
        note({ id: "a", anchor: { kind: "page", page: 2 } }),
      ],
      [],
    );
    expect(ordered.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("keeps a quote short and tidy", () => {
    expect(normalizeQuote("  una\n  pregunta  ")).toBe("una pregunta");
    expect(normalizeQuote("x".repeat(500))).toHaveLength(200);
  });
});

describe("a page being annotated", () => {
  const policyOf = (page: string) => /Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1];

  it("names one script by hash, so nothing in the file can run", async () => {
    const page = await annotatedPage(markdownPage("<p>x</p>"));
    const policy = policyOf(page) ?? "";
    expect(policy).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'; /);
    expect(policy).not.toContain("unsafe-inline'; style");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("default-src 'none'");
  });

  it("the hash is that of the script in the page", async () => {
    const page = await annotatedPage(previewPage("<p>x</p>"));
    const hash = /'sha256-([^']+)'/.exec(page)?.[1];
    const body = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    expect(btoa(String.fromCharCode(...new Uint8Array(digest)))).toBe(hash);
  });

  it("runs its script before the file's content, so the file cannot swallow it", async () => {
    const page = await annotatedPage(previewPage("<textarea><!-- <p>x</p>"));
    expect(page.indexOf("<script>")).toBeLessThan(page.indexOf("<textarea>"));
    expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<script>"));
  });

  it("is not fooled by a file that spells out the policy", async () => {
    const hostile = `content="default-src 'none'; style-src 'unsafe-inline'"><script>x()</script>`;
    const page = await annotatedPage(previewPage(hostile));
    expect(page.match(/script-src/g)).toHaveLength(1);
  });

  it("refuses a page without the expected policy rather than running unprotected", async () => {
    await expect(annotatedPage("<p>sin política</p>")).rejects.toThrow();
  });
});

describe("AnnotatedFrame", () => {
  const show = async (over: object = {}) => {
    const props = {
      onBlocks: vi.fn(),
      onAdd: vi.fn(),
      onFocus: vi.fn(),
      onFailed: vi.fn(),
    };
    renderWithProviders(
      <AnnotatedFrame
        title="Notas"
        page={markdownPage("<p>x</p>")}
        sandbox="allow-scripts"
        className=""
        marks={[{ index: 0, count: 1, done: false }]}
        canAdd
        addLabel="+ Nota"
        goTo={null}
        {...props}
        {...over}
      />,
    );
    const frame = (await screen.findByTitle("Notas")) as HTMLIFrameElement;
    const target = frame.contentWindow as Window;
    const post = vi.spyOn(target, "postMessage");
    const fromPage = (data: unknown, source: Window | null = target) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source }));
      });
    return { ...props, frame, post, fromPage };
  };

  it("runs the script and nothing more: never this tab's origin", async () => {
    const { frame } = await show();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("reports the blocks, then sends the marks", async () => {
    const { fromPage, onBlocks, post } = await show();
    fromPage({ t: "blocks", blocks: ["Uno", 2, "Dos"] });
    expect(onBlocks).toHaveBeenCalledWith(["Uno", "Dos"]);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        {
          t: "marks",
          marks: [{ index: 0, count: 1, done: false }],
          canAdd: true,
          addLabel: "+ Nota",
        },
        "*",
      ),
    );
  });

  it("takes an add for a block it was told about", async () => {
    const { fromPage, onAdd } = await show();
    fromPage({ t: "blocks", blocks: ["Uno"] });
    fromPage({ t: "add", index: 0 });
    expect(onAdd).toHaveBeenCalledWith(0);
  });

  it("takes each block's whole text for reading, only when it lines up with the blocks", async () => {
    const onFullBlocks = vi.fn();
    const { fromPage } = await show({ onFullBlocks });
    fromPage({ t: "blocks", blocks: ["Uno", "Dos"], full: ["Uno entero"] });
    fromPage({ t: "blocks", blocks: ["Uno", "Dos"], full: ["Uno entero", 2] });
    expect(onFullBlocks).not.toHaveBeenCalled();
    fromPage({ t: "blocks", blocks: ["Uno", "Dos"], full: ["Uno entero", "Dos entero"] });
    expect(onFullBlocks).toHaveBeenCalledWith(["Uno entero", "Dos entero"]);
  });

  it("tells the page what is being read, and nothing for a block it never reported", async () => {
    const view = await show({ reading: { index: 1, start: 0, end: 4 } });
    view.fromPage({ t: "blocks", blocks: ["Uno", "Dos"] });
    await waitFor(() =>
      expect(view.post).toHaveBeenCalledWith({ t: "read", index: 1, start: 0, end: 4 }, "*"),
    );
  });

  it("clears the reading mark for an index out of range", async () => {
    const view = await show({ reading: { index: 7 } });
    view.fromPage({ t: "blocks", blocks: ["Uno"] });
    await waitFor(() => expect(view.post).toHaveBeenCalledWith({ t: "read", index: null }, "*"));
  });

  it("ignores any other window, and any block number that does not exist", async () => {
    const { fromPage, onAdd, onFocus } = await show();
    fromPage({ t: "blocks", blocks: ["Uno"] });
    fromPage({ t: "add", index: 0 }, window);
    fromPage({ t: "add", index: 5 });
    fromPage({ t: "add", index: -1 });
    fromPage({ t: "add", index: "0" });
    fromPage({ t: "add", index: 0.5 });
    fromPage({ t: "focus", index: 9 });
    fromPage({ t: "otro" });
    fromPage(null);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe("FileViewer with notes", () => {
  const binding = (over: Partial<NotesBinding> = {}): NotesBinding => ({
    list: [],
    canEdit: true,
    busy: false,
    error: null,
    authorOf: () => "ana@thesomnus.com",
    add: vi.fn().mockResolvedValue(true),
    setDone: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  const viewer = (name: string, mime: string, notes: NotesBinding) =>
    renderWithProviders(
      <FileViewer
        name={name}
        mime={mime}
        bytes={new TextEncoder().encode("# Título\n\n¿Primera pregunta?\n")}
        canEditAsDocument
        onEditAsDocument={vi.fn()}
        canEditAsSheet
        onEditAsSheet={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
        notes={notes}
      />,
    );

  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.restoreAllMocks());

  it("leaves a file with no notes in the frame that can run nothing", async () => {
    viewer("notas.md", "text/markdown", binding());
    const frame = await screen.findByTitle("notas.md");
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame.getAttribute("srcdoc")).not.toContain("<script>");
  });

  it("opens a file that has notes with them showing, and the note script running", async () => {
    viewer("notas.md", "text/markdown", binding({ list: [onBlock("Título", 0)] }));
    expect(await screen.findByText("Revisar con Jesús")).toBeVisible();
    const frame = await screen.findByTitle("notas.md");
    expect(frame.getAttribute("srcdoc")).toContain("<script>");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("offers notes on a PDF by page, and jumps to the page", async () => {
    const user = userEvent.setup();
    const notes = binding({
      list: [note({ anchor: { kind: "page", page: 7 } })],
    });
    viewer("guia.pdf", "application/pdf", notes);
    await user.click(await screen.findByRole("button", { name: t("drive.notes.goTo") }));
    await waitFor(() =>
      expect(screen.getByTitle("guia.pdf")).toHaveAttribute("src", "blob:pdf#page=7"),
    );
  });

  it("adds a note on the page given", async () => {
    const user = userEvent.setup();
    const notes = binding();
    viewer("guia.pdf", "application/pdf", notes);
    await user.click(
      await screen.findByRole("button", { name: t("drive.notes.heading", { count: 0 }) }),
    );
    const page = screen.getByLabelText(t("drive.notes.page"));
    await user.clear(page);
    await user.type(page, "4");
    await user.type(screen.getByLabelText(t("drive.notes.write")), "Ver esta tabla");
    await user.click(screen.getByRole("button", { name: t("drive.notes.add") }));
    expect(notes.add).toHaveBeenCalledWith("Ver esta tabla", { kind: "page", page: 4 });
  });

  it("does not offer notes on other kinds of file", async () => {
    renderWithProviders(
      <FileViewer
        name="foto.png"
        mime="image/png"
        bytes={new Uint8Array(1)}
        canEditAsDocument
        onEditAsDocument={vi.fn()}
        canEditAsSheet
        onEditAsSheet={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
        notes={binding()}
      />,
    );
    await screen.findByRole("dialog");
    expect(
      screen.queryByRole("button", { name: t("drive.notes.heading", { count: 0 }) }),
    ).toBeNull();
  });

  it("lets someone who may only read see the notes, not change them", async () => {
    viewer(
      "guia.pdf",
      "application/pdf",
      binding({ canEdit: false, list: [note({ anchor: { kind: "page", page: 2 } })] }),
    );
    expect(await screen.findByText("Revisar con Jesús")).toBeVisible();
    expect(screen.queryByLabelText(t("drive.notes.write"))).toBeNull();
    expect(screen.queryByRole("button", { name: t("drive.notes.delete") })).toBeNull();
    expect(screen.queryByLabelText(t("drive.notes.done"))).toBeNull();
  });

  it("marks a note resolved and deletes it", async () => {
    const user = userEvent.setup();
    const notes = binding({ list: [note({ anchor: { kind: "page", page: 2 } })] });
    viewer("guia.pdf", "application/pdf", notes);
    await user.click(await screen.findByLabelText(t("drive.notes.done")));
    expect(notes.setDone).toHaveBeenCalledWith("n1", true);
    await user.click(screen.getByRole("button", { name: t("drive.notes.delete") }));
    expect(notes.remove).toHaveBeenCalledWith("n1");
  });
});
