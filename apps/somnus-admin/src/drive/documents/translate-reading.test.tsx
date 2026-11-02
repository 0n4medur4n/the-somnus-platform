import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { forgetSpeechNotices } from "./dictation.js";
import { type ReaderState, startReader, TRANSLATE_BATCH } from "./read-aloud.js";

const t = i18n.t.bind(i18n);

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => forgetSpeechNotices());

function fakeAudio() {
  const audio = {
    src: "",
    currentTime: 0,
    duration: 4,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    onended: null as (() => void) | null,
    ontimeupdate: null as (() => void) | null,
    onloadedmetadata: null as (() => void) | null,
    end: () => audio.onended?.(),
  };
  return audio;
}

const passages = Array.from({ length: 10 }, (_, i) => {
  const text = `Passage ${i + 1} in English.`;
  return { text, from: i * 40, to: i * 40 + 30, whole: true, at: [...text].map((_, c) => c) };
});
const spanish = (texts: string[]) => texts.map((text) => text.replace("Passage", "Pasaje"));

/** Translating what is read aloud (owner decision 2026-11-03). */
describe("reading a translation", () => {
  it("translates a batch at a time, speaks the translation, and asks for the next batch early", async () => {
    const audio = fakeAudio();
    const translate = vi.fn(async (texts: string[]) => spanish(texts));
    const speak = vi.fn(async (text: string) => ({
      mime: "audio/mpeg" as const,
      audio: btoa(text.length > 0 ? "x" : "y"),
    }));
    startReader({
      passages,
      speak,
      translate,
      onState: () => {},
      onPassage: () => {},
      onError: vi.fn(),
      onStop: vi.fn(),
      audio,
    });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    expect(translate).toHaveBeenCalledTimes(1);
    expect(translate.mock.calls[0]?.[0]).toEqual(
      passages.slice(0, TRANSLATE_BATCH).map((p) => p.text),
    );
    expect(speak.mock.calls[0]?.[0]).toBe("Pasaje 1 in English.");

    // Halfway through the first batch, the second is already on its way.
    for (let n = 2; n <= TRANSLATE_BATCH / 2 + 1; n++) {
      audio.end();
      await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(n));
    }
    await waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    expect(translate.mock.calls[1]?.[0]).toEqual(
      passages.slice(TRANSLATE_BATCH).map((p) => p.text),
    );
  });

  it("follows the translated words in the caption, not in the document", async () => {
    const audio = fakeAudio();
    let tick: (() => void) | null = null;
    const states: ReaderState[] = [];
    const onWord = vi.fn();
    startReader({
      passages: passages.slice(0, 1),
      translate: async () => ["Hola equipo"],
      speak: async () => ({
        mime: "audio/mpeg",
        audio: "SUQz",
        words: [
          { start: 0, end: 4, time: 0 },
          { start: 5, end: 11, time: 0.5 },
        ],
      }),
      onState: (s) => states.push(s),
      onPassage: () => {},
      onWord,
      onError: vi.fn(),
      onStop: vi.fn(),
      audio,
      frame: (callback) => {
        tick = callback;
        return () => {
          tick = null;
        };
      },
    });
    await waitFor(() => expect(tick).not.toBeNull());
    expect(states.at(-1)?.caption).toEqual({ text: "Hola equipo", word: null });
    audio.currentTime = 0.6;
    (tick as unknown as () => void)();
    expect(states.at(-1)?.caption).toEqual({ text: "Hola equipo", word: [5, 11] });
    expect(onWord).not.toHaveBeenCalled();
  });

  it("reads a passage as written when its translation comes back empty", async () => {
    const speak = vi.fn(async () => ({ mime: "audio/mpeg" as const, audio: "SUQz" }));
    const audio = fakeAudio();
    startReader({
      passages: passages.slice(0, 2),
      translate: async () => ["", "Pasaje 2."],
      speak,
      onState: () => {},
      onPassage: () => {},
      onError: vi.fn(),
      onStop: vi.fn(),
      audio,
    });
    await waitFor(() => expect(speak).toHaveBeenCalledTimes(2));
    expect(speak.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "Passage 1 in English.",
      "Pasaje 2.",
    ]);
  });

  it("says when the translation fails, and stops without speaking", async () => {
    const errors: string[] = [];
    const onStop = vi.fn();
    const speak = vi.fn();
    startReader({
      passages,
      translate: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 503 })),
      speak,
      onState: () => {},
      onPassage: () => {},
      onError: (e) => errors.push(e),
      onStop,
      audio: fakeAudio(),
    });
    await waitFor(() => expect(onStop).toHaveBeenCalled());
    expect(errors).toEqual(["translation"]);
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("translation in the editor's reader", () => {
  const content: JSONContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
      { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
    ],
  };

  it("is offered only with the service, and names Gemini before the first text goes", async () => {
    const user = userEvent.setup();
    const readAloud = vi.fn().mockReturnValue(new Promise(() => {}));
    const translate = vi.fn(async (texts: string[]) => texts.map((x) => `ES ${x}`));
    const { unmount } = renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={content}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
        voice={{ dictation: vi.fn(), readAloud, translate }}
      />,
    );
    const toggle = screen.getByRole("button", {
      name: t("drive.doc.translate.toggle", { lang: t("drive.doc.voiceLang.es") }),
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: t("drive.doc.readAloud.start") }));
    await user.click(screen.getByRole("button", { name: t("drive.doc.readAloud.accept") }));
    expect(
      screen.getByRole("dialog", { name: t("drive.doc.translate.noticeTitle") }),
    ).toBeVisible();
    expect(translate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("drive.doc.translate.accept") }));
    await waitFor(() =>
      expect(translate).toHaveBeenCalledWith(["First paragraph.", "Second paragraph."], "es"),
    );
    await waitFor(() => expect(readAloud).toHaveBeenCalledWith("ES First paragraph.", "es"));
    unmount();

    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={content}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
        voice={{ dictation: vi.fn(), readAloud }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Traducir|Translate/ })).toBeNull();
  });
});
