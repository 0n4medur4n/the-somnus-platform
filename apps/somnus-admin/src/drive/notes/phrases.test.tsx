import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { markdownPage } from "../documents/markdown.js";
import { PdfFrame } from "../pdf/PdfFrame.js";
import { FileViewer } from "../ui/FileViewer.js";
import { AnnotatedFrame } from "./AnnotatedFrame.js";
import {
  type DriveNote,
  decodeNotes,
  encodeNotes,
  marksFor,
  type NoteAnchor,
  phraseAnchor,
  textMarksFor,
} from "./notes-format.js";
import type { NotesBinding } from "./use-notes.js";

const t = i18n.t.bind(i18n);

const BLOCKS = ["Pacto de Socios", "Los Fundadores han desarrollado conjuntamente el proyecto."];

function note(anchor: NoteAnchor, text = ""): DriveNote {
  return { id: "n1", authorId: "u1", text, createdAt: "2026-11-02T10:00:00Z", done: false, anchor };
}

describe("marked phrases", () => {
  it("takes the phrase from the console's own text, never from the frame", () => {
    const anchor = phraseAnchor(BLOCKS, 1, 4, 14, "green");
    expect(anchor).toEqual({
      kind: "text",
      quote: BLOCKS[1],
      index: 1,
      phrase: "Fundadores",
      start: 4,
      end: 14,
      color: "green",
    });
    expect(phraseAnchor(BLOCKS, 1, 10, 5, "green")).toBeNull();
    expect(phraseAnchor(BLOCKS, 1, 0, 999, "green")).toBeNull();
    expect(phraseAnchor(BLOCKS, 7, 0, 3, "green")).toBeNull();
    expect(phraseAnchor(BLOCKS, 1.5, 0, 3, "green")).toBeNull();
    expect(phraseAnchor(["   "], 0, 0, 2, "green")).toBeNull();
    expect(phraseAnchor(BLOCKS, 1, 4, 15, "green")).toMatchObject({
      phrase: "Fundadores",
      end: 14,
    });
  });

  it("finds a phrase again where it is now, and not at all once its words are gone", () => {
    const anchor = phraseAnchor(BLOCKS, 1, 4, 14, "blue") as NoteAnchor;
    expect(textMarksFor([note(anchor)], BLOCKS)).toEqual([
      { id: "n1", index: 1, start: 4, end: 14, color: "blue" },
    ]);
    const moved = ["Nuevo título", "Pacto de Socios", `Hoy, l${BLOCKS[1]?.slice(1)}`];
    // The block moved (found by its opening) and the words moved within it.
    expect(textMarksFor([note(anchor)], [BLOCKS[1] as string, ...moved])).toEqual([
      { id: "n1", index: 0, start: 4, end: 14, color: "blue" },
    ]);
    expect(textMarksFor([note(anchor)], ["Pacto de Socios", "Otro texto entero."])).toEqual([]);
    // A phrase is marked in its own colour, not as a yellow block.
    expect(marksFor([note(anchor)], BLOCKS)).toEqual([]);
  });

  it("keeps marks through the stored format and drops broken ones", () => {
    const anchor = phraseAnchor(BLOCKS, 1, 4, 14, "pink") as NoteAnchor;
    const stored = encodeNotes([note(anchor, "Revisar")]);
    expect(decodeNotes(stored)[0]?.anchor).toEqual(anchor);
    const broken = (extra: object) =>
      decodeNotes(encodeNotes([note({ ...anchor, ...extra } as NoteAnchor)]));
    expect(broken({ end: 2 })).toEqual([]);
    expect(broken({ phrase: "" })).toEqual([]);
    expect(broken({ start: -1 })).toEqual([]);
    expect(broken({ color: "black" })[0]?.anchor).toMatchObject({ color: "yellow" });
  });
});

describe("selections from the frames", () => {
  async function frameWith(onSelect: (choice: unknown) => void) {
    renderWithProviders(
      <AnnotatedFrame
        title="Notas"
        page={markdownPage("<p>x</p>")}
        sandbox="allow-scripts"
        className=""
        marks={[]}
        canAdd
        addLabel="+"
        goTo={null}
        phrases={{ marks: [], labels: { comment: "Comentar", colors: {} } }}
        onSelect={onSelect}
        onBlocks={vi.fn()}
        onAdd={vi.fn()}
        onFocus={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    const frame = (await screen.findByTitle("Notas")) as HTMLIFrameElement;
    const source = frame.contentWindow as Window;
    const post = vi.spyOn(source, "postMessage");
    const say = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source }));
      });
    return { say, post };
  }

  it("sends the marks, and passes on only selections inside a block it reported", async () => {
    const onSelect = vi.fn();
    const { say, post } = await frameWith(onSelect);
    say({ t: "blocks", blocks: ["Uno", "Dos"] });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        { t: "phrases", marks: [], labels: { comment: "Comentar", colors: {} } },
        "*",
      ),
    );
    say({ t: "select", index: 5, start: 0, end: 2, color: "green", comment: false });
    say({ t: "select", index: 1, start: 3, end: 1, color: "green", comment: false });
    say({ t: "select", index: 1, start: 0, end: 2, color: 4, comment: false });
    expect(onSelect).not.toHaveBeenCalled();
    say({ t: "select", index: 1, start: 0, end: 2, color: "green", comment: "yes" });
    expect(onSelect).toHaveBeenCalledWith({
      index: 1,
      start: 0,
      end: 2,
      color: "green",
      comment: false,
    });
  });

  it("from a PDF, passes on only selections on a page it reported", async () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <PdfFrame
        title="guia.pdf"
        bytes={new Uint8Array([1])}
        goTo={null}
        reading={{ page: null }}
        onSelect={onSelect}
        onPages={vi.fn()}
        onFailed={vi.fn()}
      />,
    );
    const frame = (await screen.findByTitle("guia.pdf")) as HTMLIFrameElement;
    const source = frame.contentWindow as Window;
    const say = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source }));
      });
    say({ t: "select", index: 0, start: 0, end: 2, color: "blue", comment: true });
    expect(onSelect).not.toHaveBeenCalled();
    say({ t: "pages", texts: ["Página uno"] });
    say({ t: "select", index: 1, start: 0, end: 2, color: "blue", comment: true });
    say({ t: "select", index: 0, start: 0, end: 2, color: "blue", comment: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      index: 0,
      start: 0,
      end: 2,
      color: "blue",
      comment: true,
    });
  });
});

describe("marking in a preview", () => {
  function binding(): NotesBinding {
    return {
      list: [],
      canEdit: true,
      busy: false,
      error: null,
      authorOf: () => "yo",
      add: vi.fn().mockResolvedValue(true),
      setDone: vi.fn(),
      remove: vi.fn(),
    } as unknown as NotesBinding;
  }

  it("marks a phrase at once, or opens the panel to comment on it", async () => {
    const notes = binding();
    renderWithProviders(
      <FileViewer
        name="pacto.md"
        mime="text/markdown"
        bytes={new TextEncoder().encode("Pacto de Socios")}
        canEditAsDocument={false}
        onEditAsDocument={vi.fn()}
        canEditAsSheet={false}
        onEditAsSheet={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
        notes={notes}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: t("drive.notes.heading", { count: 0 }) }),
    );
    const frame = (await screen.findByTitle("pacto.md")) as HTMLIFrameElement;
    const source = frame.contentWindow as Window;
    const say = (data: unknown) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source }));
      });
    say({ t: "blocks", blocks: BLOCKS, full: BLOCKS });
    say({ t: "select", index: 1, start: 4, end: 14, color: "green", comment: false });
    await waitFor(() =>
      expect(notes.add).toHaveBeenCalledWith(
        "",
        expect.objectContaining({ phrase: "Fundadores", color: "green" }),
      ),
    );
    say({ t: "select", index: 0, start: 0, end: 5, color: "yellow", comment: true });
    expect(await screen.findByText("«Pacto»")).toBeVisible();
    await user.type(screen.getByLabelText(t("drive.notes.write")), "¿Firmado?");
    await user.click(screen.getByRole("button", { name: t("drive.notes.add") }));
    expect(notes.add).toHaveBeenLastCalledWith(
      "¿Firmado?",
      expect.objectContaining({ kind: "text", phrase: "Pacto", index: 0 }),
    );
  });
});
