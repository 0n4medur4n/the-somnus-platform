import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { forgetSpeechNotices } from "./dictation.js";
import { documentExtensions } from "./doc-format.js";
import type { Proofreader } from "./ProofreadTools.js";
import {
  applySuggestions,
  chunksOf,
  Proofreading,
  placeSuggestions,
  setSuggestions,
  suggestionsOf,
} from "./proofreading.js";

const t = i18n.t.bind(i18n);
const TEXT = "Ayer fuimos al medico y nos digeron que todo estava bien.";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function editorWith(...texts: string[]) {
  return new Editor({
    extensions: [...documentExtensions(), Proofreading],
    content: { type: "doc", content: texts.map(paragraph) },
  });
}

afterEach(() => forgetSpeechNotices());

describe("proofreading a document", () => {
  it("sends paragraphs together up to the limit, and knows where each character is", () => {
    const editor = editorWith("Uno.", "Dos.", "Tres.");
    const chunks = chunksOf(editor.state.doc, 9);
    editor.destroy();
    expect(chunks.map((c) => c.text)).toEqual(["Uno.\nDos.", "Tres."]);
    expect(chunks[0]?.at[4]).toBe(-1);
    expect(chunks[0]?.at[0]).toBe(1);
  });

  it("keeps only corrections that land exactly on the words they change", () => {
    const editor = editorWith(TEXT, "Segundo parrafo.");
    const [chunk] = chunksOf(editor.state.doc);
    if (!chunk) throw new Error("no chunk");
    const at = (word: string) => chunk.text.indexOf(word);
    const placed = placeSuggestions(editor.state.doc, chunk, {
      suggestions: [
        { start: at("medico"), end: at("medico") + 6, replacement: "médico", reason: "Tilde" },
        // Across two paragraphs: dropped.
        { start: at("bien."), end: at("Segundo") + 3, replacement: "x", reason: "" },
        // Past the text: dropped.
        { start: 500, end: 510, replacement: "x", reason: "" },
        { start: at("parrafo"), end: at("parrafo") + 7, replacement: "párrafo", reason: "Tilde" },
      ],
    });
    expect(placed.map((s) => [s.original, s.replacement])).toEqual([
      ["medico", "médico"],
      ["parrafo", "párrafo"],
    ]);
    expect(editor.state.doc.textBetween(placed[1]?.from ?? 0, placed[1]?.to ?? 0)).toBe("parrafo");
    editor.destroy();
  });

  it("follows edits, drops a suggestion whose words changed, and applies the rest", () => {
    const editor = editorWith(TEXT);
    const [chunk] = chunksOf(editor.state.doc);
    if (!chunk) throw new Error("no chunk");
    const at = (word: string) => chunk.text.indexOf(word);
    const found = placeSuggestions(editor.state.doc, chunk, {
      suggestions: [
        { start: at("medico"), end: at("medico") + 6, replacement: "médico", reason: "" },
        { start: at("digeron"), end: at("digeron") + 7, replacement: "dijeron", reason: "" },
        { start: at("estava"), end: at("estava") + 6, replacement: "estaba", reason: "" },
      ],
    });
    editor.view.dispatch(setSuggestions(editor.state.tr, found));
    // Typing before them moves them; editing one of them removes it.
    editor.view.dispatch(editor.state.tr.insertText("Hoy. ", 1));
    const digeron = suggestionsOf(editor.state).items.find((s) => s.original === "digeron");
    if (!digeron) throw new Error("lost");
    editor.view.dispatch(editor.state.tr.insertText("x", digeron.from + 2));
    expect(suggestionsOf(editor.state).items.map((s) => s.original)).toEqual(["medico", "estava"]);

    const tr = applySuggestions(
      editor.state,
      suggestionsOf(editor.state).items.map((s) => s.id),
    );
    if (tr) editor.view.dispatch(tr);
    expect(editor.state.doc.textContent).toBe(
      "Hoy. Ayer fuimos al médico y nos dixgeron que todo estaba bien.",
    );
    expect(suggestionsOf(editor.state).items).toEqual([]);
    editor.destroy();
  });
});

describe("the proofreader in the editor", () => {
  const show = (proofread: Proofreader) =>
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{ type: "doc", content: [paragraph(TEXT)] }}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
        proofread={proofread}
      />,
    );
  const reply = (text: string) => ({
    suggestions: [
      {
        start: text.indexOf("medico"),
        end: text.indexOf("medico") + 6,
        replacement: "médico",
        reason: "Tilde",
      },
    ],
  });

  it("says where the text goes first, then suggests without changing anything", async () => {
    const user = userEvent.setup();
    const proofread = vi.fn(async (text: string) => reply(text));
    show(proofread);
    await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.start") }));
    expect(
      screen.getByRole("dialog", { name: t("drive.doc.proofread.noticeTitle") }),
    ).toBeVisible();
    expect(proofread).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.noticeAccept") }));
    expect(await screen.findByText(t("drive.doc.proofread.count", { count: 1 }))).toBeVisible();
    expect(proofread).toHaveBeenCalledWith(TEXT, "es");
    // Suggested, not applied.
    expect(screen.getByText(/medico/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.acceptAll") }));
    await waitFor(() => expect(screen.getByText(/médico/)).toBeVisible());
  });

  it("corrects directly when asked to, undoably", async () => {
    const user = userEvent.setup();
    const proofread = vi.fn(async (text: string) => reply(text));
    show(proofread);
    await user.selectOptions(screen.getByLabelText(t("drive.doc.proofread.mode")), "apply");
    await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.start") }));
    await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.noticeAccept") }));
    expect(await screen.findByText(t("drive.doc.proofread.applied", { count: 1 }))).toBeVisible();
    expect(screen.getByText(/médico/)).toBeVisible();
  });

  it("says plainly when proofreading is unavailable", async () => {
    const user = userEvent.setup();
    const proofread = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 503 }));
    show(proofread);
    await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.start") }));
    await act(async () => {
      await user.click(screen.getByRole("button", { name: t("drive.doc.proofread.noticeAccept") }));
    });
    expect(await screen.findByText(t("drive.doc.proofread.unavailable"))).toBeVisible();
  });
});
