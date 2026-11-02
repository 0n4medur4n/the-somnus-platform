import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { DocumentEditor } from "./DocumentEditor.js";
import {
  type DictationRuntime,
  forgetSpeechNotices,
  insertDictation,
  spokenText,
  startDictation,
} from "./dictation.js";
import { documentExtensions } from "./doc-format.js";
import {
  type Passage,
  passagesFrom,
  passagesOfSelection,
  passagesOfTexts,
  type ReaderState,
  splitText,
  startReader,
  wordAt,
  wordRange,
} from "./read-aloud.js";

const t = i18n.t.bind(i18n);

beforeEach(() => {
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:${Math.random()}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  forgetSpeechNotices();
});

describe("dictated text", () => {
  it("turns spoken punctuation into marks, without doubling what the service added", () => {
    expect(spokenText("hola coma qué tal punto", "es")).toBe("hola, qué tal.");
    expect(spokenText("Hola, coma qué tal, punto.", "es")).toBe("Hola, qué tal.");
    expect(spokenText("Vale. Abrir interrogación vienes cerrar interrogación", "es")).toBe(
      "Vale. ¿vienes?",
    );
    expect(spokenText("primero punto y aparte segundo", "es")).toBe("primero.\nsegundo");
    expect(spokenText("uno punto y coma dos dos puntos tres", "es")).toBe("uno; dos: tres");
    expect(spokenText("el puntual", "es")).toBe("el puntual");
    expect(spokenText("hello comma world full stop", "en")).toBe("hello, world.");
    expect(spokenText("bonjour virgule ça va point d'interrogation", "fr")).toBe("bonjour, ça va?");
  });

  it("goes in at the caret with spaces and capitals where a sentence starts", () => {
    const editor = new Editor({
      extensions: documentExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    insertDictation(editor, "hola, qué tal.");
    insertDictation(editor, "bien");
    insertDictation(editor, ", gracias.\notra línea");
    const paragraphs = (editor.getJSON() as JSONContent).content?.map((p) => p.content?.[0]?.text);
    editor.destroy();
    expect(paragraphs).toEqual(["Hola, qué tal. Bien, gracias.", "Otra línea"]);
  });
});

/** A browser with a microphone, an audio graph and a socket, all fake. */
function fakeBrowser() {
  const sockets: FakeSocket[] = [];
  const tracks = [{ stop: vi.fn() }];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    binaryType = "blob";
    sent: unknown[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    constructor(readonly url: string) {
      sockets.push(this);
    }
    send(data: unknown) {
      this.sent.push(data);
    }
    close(code: number) {
      this.readyState = 3;
      this.onclose?.({ code } as CloseEvent);
    }
    say(message: unknown) {
      this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
    }
  }
  const node = () => ({ connect: (next: unknown) => next });
  let worklet: { port: { onmessage: ((event: MessageEvent) => void) | null } } | null = null;
  class FakeWorkletNode {
    port = { onmessage: null as ((event: MessageEvent) => void) | null };
    connect = (next: unknown) => next;
    constructor() {
      worklet = this;
    }
  }
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  class FakeAudioContext {
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    destination = {};
    createMediaStreamSource = node;
    createGain = () => ({ gain: { value: 1 }, connect: (next: unknown) => next });
    close = vi.fn().mockResolvedValue(undefined);
    resume = vi.fn().mockResolvedValue(undefined);
  }
  const runtime: DictationRuntime = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => tracks }),
    WebSocket: FakeSocket as unknown as typeof WebSocket,
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
  };
  return { runtime, sockets, tracks, worklet: () => worklet };
}

describe("dictation through AssemblyAI", () => {
  const session = {
    url: "wss://streaming.eu.assemblyai.com/v3/ws?token=t",
    sampleRate: 16_000 as const,
    expiresInSeconds: 60,
  };

  it("streams the microphone and writes each finished, formatted turn", async () => {
    const browser = fakeBrowser();
    const interim: string[] = [];
    const finals: string[] = [];
    const onStop = vi.fn();
    const open = vi.fn().mockResolvedValue(session);
    const running = await startDictation({
      open,
      onInterim: (text) => interim.push(text),
      onFinal: (text) => finals.push(text),
      onError: vi.fn(),
      onStop,
      runtime: browser.runtime,
    });
    expect(running).not.toBeNull();
    const socket = browser.sockets[0];
    if (!socket) throw new Error("no socket");
    expect(socket.url).toBe(session.url);
    expect(socket.binaryType).toBe("arraybuffer");

    // Audio from the worklet goes out as binary frames.
    const pcm = new Int16Array(1600).buffer;
    browser.worklet()?.port.onmessage?.({ data: pcm } as MessageEvent);
    expect(socket.sent).toEqual([pcm]);

    socket.say({ type: "Turn", transcript: "hola qué", end_of_turn: false });
    socket.say({ type: "Turn", transcript: "hola qué tal", end_of_turn: true });
    socket.say({
      type: "Turn",
      transcript: "Hola, ¿qué tal?",
      end_of_turn: true,
      turn_is_formatted: true,
    });
    expect(interim).toContain("hola qué");
    expect(interim).toContain("hola qué tal");
    expect(finals).toEqual(["Hola, ¿qué tal?"]);

    // Stopping asks for the last sentence, and ends once the service says so.
    running?.stop();
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "Terminate" }));
    expect(onStop).not.toHaveBeenCalled();
    socket.say({ type: "Termination", audio_duration_seconds: 3 });
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(browser.tracks[0]?.stop).toHaveBeenCalled();
  });

  it("says when the microphone is refused, and asks the server for nothing", async () => {
    const browser = fakeBrowser();
    browser.runtime.getUserMedia = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const open = vi.fn();
    const errors: string[] = [];
    await startDictation({
      open,
      onInterim() {},
      onFinal() {},
      onError: (e) => errors.push(e),
      onStop() {},
      runtime: browser.runtime,
    });
    expect(errors).toEqual(["denied"]);
    expect(open).not.toHaveBeenCalled();
  });

  it("releases the microphone when no pass is available", async () => {
    const browser = fakeBrowser();
    const errors: string[] = [];
    const onStop = vi.fn();
    const result = await startDictation({
      open: vi.fn().mockRejectedValue(new Error("503")),
      onInterim() {},
      onFinal() {},
      onError: (e) => errors.push(e),
      onStop,
      runtime: browser.runtime,
    });
    expect(result).toBeNull();
    expect(errors).toEqual(["unavailable"]);
    expect(browser.tracks[0]?.stop).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });

  it("reports a dropped connection", async () => {
    const browser = fakeBrowser();
    const errors: string[] = [];
    await startDictation({
      open: vi.fn().mockResolvedValue(session),
      onInterim() {},
      onFinal() {},
      onError: (e) => errors.push(e),
      onStop() {},
      runtime: browser.runtime,
    });
    browser.sockets[0]?.onclose?.({ code: 1006 } as CloseEvent);
    expect(errors).toEqual(["network"]);
  });
});

describe("reading aloud", () => {
  const doc = (content: JSONContent[]) =>
    new Editor({ extensions: documentExtensions(), content: { type: "doc", content } });
  const paragraph = (text: string): JSONContent => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  });

  it("reads every paragraph whole, from the caret on (it once stopped at 200 characters)", () => {
    const long = `${"Los Fundadores han desarrollado conjuntamente el proyecto. ".repeat(10)}Fin del párrafo.`;
    const editor = doc([paragraph("Antes."), paragraph(long), paragraph("Después.")]);
    const second = editor.state.doc.child(0).nodeSize + 1;
    const passages = passagesFrom(editor.state.doc, second);
    editor.destroy();
    expect(passages.map((p) => p.text)).toEqual([long.trim(), "Después."]);
    expect(passages[0]?.text.endsWith("Fin del párrafo.")).toBe(true);
    expect(passages.every((p) => p.whole && p.to > p.from)).toBe(true);
  });

  it("reads table cells and list items, and cuts a very long paragraph at sentence ends", () => {
    const editor = doc([
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph("Uno de la lista.")] }],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("Socio")] },
              { type: "tableCell", content: [paragraph("Rol")] },
            ],
          },
        ],
      },
    ]);
    expect(passagesFrom(editor.state.doc, 0).map((p) => p.text)).toEqual([
      "Uno de la lista.",
      "Socio",
      "Rol",
    ]);
    editor.destroy();
    const parts = splitText("Frase larga de prueba. ".repeat(120));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(900);
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(4800);
    }
  });

  it("reads a preview's blocks by number, each character at its offset", () => {
    const passages = passagesOfTexts(["Pacto", "", "Primer párrafo."]);
    expect(passages.map((p) => [p.from, p.text])).toEqual([
      [0, "Pacto"],
      [2, "Primer párrafo."],
    ]);
    expect(wordRange(passages[1] as Passage, 7, 15)).toEqual([7, 15]);
  });

  it("reads a selection as it is", () => {
    const editor = doc([paragraph("Primera frase."), paragraph("Segunda frase.")]);
    const passages = passagesOfSelection(editor.state.doc, 1, editor.state.doc.content.size);
    editor.destroy();
    expect(passages.map((p) => p.text)).toEqual(["Primera frase. Segunda frase."]);
    expect(passages[0]?.whole).toBe(false);
  });

  /** An audio element that "plays" when told to finish. */
  function fakeAudio() {
    const audio = {
      src: "",
      currentTime: 0,
      duration: 12,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      onended: null as (() => void) | null,
      ontimeupdate: null as (() => void) | null,
      onloadedmetadata: null as (() => void) | null,
      end: () => audio.onended?.(),
    };
    return audio;
  }
  const passages = ["uno", "dos", "tres", "cuatro"].map((text, i) => ({
    text,
    from: i * 10,
    to: i * 10 + 5,
    whole: true,
    at: [...text].map((_, c) => i * 10 + 1 + c),
  }));

  it("plays in order, asks ahead, highlights each part, and stops at the end", async () => {
    const audio = fakeAudio();
    const speak = vi.fn(async (text: string) => ({
      mime: "audio/mpeg" as const,
      audio: btoa(text),
    }));
    const followed: Array<string | null> = [];
    const onStop = vi.fn();
    startReader({
      passages,
      speak,
      onState: () => {},
      onPassage: (p) => followed.push(p?.text ?? null),
      onError: vi.fn(),
      onStop,
      audio,
    });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    // The first and the two after it were asked for at once.
    expect(speak.mock.calls.map((c) => c[0])).toEqual(["uno", "dos", "tres"]);
    for (const n of [2, 3, 4]) {
      audio.end();
      await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(n));
    }
    audio.end();
    await waitFor(() => expect(onStop).toHaveBeenCalled());
    expect(followed).toEqual(["uno", "dos", "tres", "cuatro", null]);
  });

  it("pauses, continues where it was, and jumps on the timeline", async () => {
    const audio = fakeAudio();
    const states: ReaderState[] = [];
    const reader = startReader({
      passages,
      speak: async (text) => ({ mime: "audio/mpeg", audio: btoa(text) }),
      onState: (s) => states.push(s),
      onPassage: () => {},
      onError: vi.fn(),
      onStop: vi.fn(),
      audio,
    });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(1));
    audio.currentTime = 5;
    reader.pause();
    expect(audio.pause).toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({ playing: false, position: 5, duration: 12, index: 0 });
    reader.resume();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.currentTime).toBe(5);

    reader.seek(3);
    await waitFor(() => expect(states.at(-1)).toMatchObject({ index: 3, loading: false }));
    expect(audio.src).toContain("blob:");
    expect(states.at(-1)?.total).toBe(4);
  });

  it("follows the voice word by word, from the times Google reports", async () => {
    const audio = fakeAudio();
    let tick: (() => void) | null = null;
    const followed: Array<[number, number] | null> = [];
    startReader({
      passages: [
        {
          text: "Hola equipo de guardia",
          from: 0,
          to: 24,
          whole: true,
          at: [...Array(22).keys()].map((c) => c + 1),
        },
      ],
      speak: async () => ({
        mime: "audio/mpeg",
        audio: "SUQz",
        words: [
          { start: 0, end: 4, time: 0 },
          { start: 5, end: 11, time: 0.4 },
          { start: 12, end: 14, time: 0.9 },
          { start: 15, end: 22, time: 1.1 },
        ],
      }),
      onState: () => {},
      onPassage: () => {},
      onWord: (_passage, word) => followed.push(word),
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
    for (const time of [0.1, 0.5, 0.6, 1.2]) {
      audio.currentTime = time;
      (tick as unknown as () => void)();
    }
    // Each word once, as it starts; the same word is not reported twice.
    expect(followed).toEqual([
      [0, 4],
      [5, 11],
      [15, 22],
    ]);
  });

  it("knows where each spoken word is in the document", () => {
    const editor = doc([paragraph("El   presente pacto")]);
    const [passage] = passagesFrom(editor.state.doc, 0);
    editor.destroy();
    if (!passage) throw new Error("no passage");
    // Spaces collapse for the voice, but positions still point at the document.
    expect(passage.text).toBe("El presente pacto");
    expect(wordRange(passage, 3, 11)).toEqual([6, 14]);
    expect(wordAt([{ start: 0, end: 2, time: 0.2 }], 0.1)).toBeNull();
  });

  it("says when the voice service is unavailable, and stops", async () => {
    const errors: string[] = [];
    const onStop = vi.fn();
    startReader({
      passages,
      speak: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 502 })),
      onState: () => {},
      onPassage: () => {},
      onError: (e) => errors.push(e),
      onStop,
      audio: fakeAudio(),
    });
    await waitFor(() => expect(onStop).toHaveBeenCalled());
    expect(errors).toEqual(["unavailable"]);
  });
});

describe("voice in the editor", () => {
  const content: JSONContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Primer párrafo." }] },
      { type: "paragraph", content: [{ type: "text", text: "Segundo párrafo." }] },
    ],
  };

  it("offers neither without the voice services", () => {
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={content}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: t("drive.doc.dictation.start") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("drive.doc.readAloud.start") })).toBeNull();
  });

  it("says where the text goes before reading it aloud, then sends the document", async () => {
    const user = userEvent.setup();
    const readAloud = vi.fn().mockReturnValue(new Promise(() => {}));
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
    await user.click(screen.getByRole("button", { name: t("drive.doc.readAloud.start") }));
    expect(
      screen.getByRole("dialog", { name: t("drive.doc.readAloud.noticeTitle") }),
    ).toBeVisible();
    expect(readAloud).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: t("drive.doc.readAloud.accept") }));
    await waitFor(() => expect(readAloud).toHaveBeenCalledWith("Primer párrafo.", "es"));
    expect(screen.getByRole("button", { name: t("drive.doc.readAloud.stop") })).toBeVisible();
  });

  it("reads in the language chosen beside the buttons, Catalan included", async () => {
    const user = userEvent.setup();
    const readAloud = vi.fn().mockReturnValue(new Promise(() => {}));
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
    const select = screen.getByLabelText(t("drive.doc.voiceLang.label")) as HTMLSelectElement;
    expect(select.value).toBe("es");
    await user.selectOptions(select, "ca");
    await user.click(screen.getByRole("button", { name: t("drive.doc.readAloud.start") }));
    await user.click(screen.getByRole("button", { name: t("drive.doc.readAloud.accept") }));
    await waitFor(() => expect(readAloud).toHaveBeenCalledWith(expect.any(String), "ca"));
  });

  it("says so when the browser cannot dictate", async () => {
    const user = userEvent.setup();
    const dictation = vi.fn();
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={content}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
        voice={{ dictation, readAloud: vi.fn() }}
      />,
    );
    await user.click(screen.getByRole("button", { name: t("drive.doc.dictation.start") }));
    expect(screen.getByText(t("drive.doc.dictation.error.unsupported"))).toBeVisible();
    expect(dictation).not.toHaveBeenCalled();
  });
});
