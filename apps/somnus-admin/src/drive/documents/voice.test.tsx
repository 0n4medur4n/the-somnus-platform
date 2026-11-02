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
import { passagesOf, startReadAloud } from "./read-aloud.js";

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
  it("groups paragraphs into passages that each fit Google's limit", () => {
    expect(passagesOf(["Uno.", "", "Dos."])).toEqual(["Uno.\nDos."]);
    const long = `${"Frase larga de prueba. ".repeat(120)}`;
    const parts = passagesOf([long]);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(900);
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(4800);
    }
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long.trim().replace(/\s+/g, " "));
  });

  it("plays passages in order, asking for the next while one plays", async () => {
    const played: string[] = [];
    const speak = vi.fn(async (text: string) => ({
      mime: "audio/mpeg" as const,
      audio: btoa(text),
    }));
    let urls = 0;
    Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${urls++}`) });
    const onStop = vi.fn();
    startReadAloud({
      passages: ["uno", "dos", "tres"],
      speak,
      onPassage: () => {},
      onError: vi.fn(),
      onStop,
      player: {
        play: async (url) => {
          played.push(url);
          // While the first plays, the second is already on its way.
          if (played.length === 1) expect(speak).toHaveBeenCalledTimes(2);
        },
        stop: () => {},
      },
    });
    await waitFor(() => expect(onStop).toHaveBeenCalled());
    expect(speak.mock.calls.map((c) => c[0])).toEqual(["uno", "dos", "tres"]);
    expect(played).toHaveLength(3);
  });

  it("stops when asked, and says when the service is unavailable", async () => {
    const errors: string[] = [];
    const onStop = vi.fn();
    startReadAloud({
      passages: ["uno"],
      speak: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { status: 503 })),
      onPassage: () => {},
      onError: (e) => errors.push(e),
      onStop,
      player: { play: async () => {}, stop: () => {} },
    });
    await waitFor(() => expect(onStop).toHaveBeenCalled());
    expect(errors).toEqual(["unavailable"]);

    let finish = () => {};
    const stopped = vi.fn();
    const reading = startReadAloud({
      passages: ["uno", "dos"],
      speak: async () => ({ mime: "audio/mpeg", audio: "SUQz" }),
      onPassage: () => {},
      onError: vi.fn(),
      onStop: stopped,
      player: {
        play: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        stop: () => finish(),
      },
    });
    await waitFor(() => expect(finish).not.toBe(undefined));
    await new Promise((r) => setTimeout(r, 20));
    reading.stop();
    await waitFor(() => expect(stopped).toHaveBeenCalled());
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
    await waitFor(() =>
      expect(readAloud).toHaveBeenCalledWith("Primer párrafo.\nSegundo párrafo.", "es"),
    );
    expect(screen.getByRole("button", { name: t("drive.doc.readAloud.stop") })).toBeVisible();
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
