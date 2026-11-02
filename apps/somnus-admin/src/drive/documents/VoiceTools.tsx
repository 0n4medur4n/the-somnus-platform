import type {
  DriveDictationSession,
  DriveReadAloudResult,
  DriveSpeechLang,
} from "@somnus/api-contracts";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Icon } from "../../components/ui/Icon.js";
import { Modal } from "../../components/ui/ui.js";
import {
  acceptSpeechNotice,
  type DictationError,
  dictationSupported,
  insertDictation,
  speechNoticeSeen,
  spokenText,
  startDictation,
} from "./dictation.js";
import {
  type Passage,
  passageMeta,
  passagesFrom,
  passagesOfSelection,
  type ReadAloudError,
  type Reader,
  type ReaderState,
  readingKey,
  startReader,
  wordMeta,
  wordRange,
} from "./read-aloud.js";

/** Our two voice services, as the Drive reaches them (owner decision 2026-11-02). */
export type VoiceBinding = {
  dictation: (lang: DriveSpeechLang) => Promise<DriveDictationSession>;
  readAloud: (text: string, lang: DriveSpeechLang) => Promise<DriveReadAloudResult>;
};

const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();

export function langOf(language: string): DriveSpeechLang {
  const base = language.slice(0, 2).toLowerCase();
  return base === "en" || base === "ca" || base === "fr" ? base : "es";
}

/** Says where the words go before they go, once per session. */
function SpeechNotice({
  kind,
  onAccept,
  onClose,
}: {
  kind: "dictation" | "readAloud";
  onAccept: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal title={t(`drive.doc.${kind}.noticeTitle`)} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm text-somnus-subtle">
        <p>{t(`drive.doc.${kind}.notice`)}</p>
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-amber-200">
          {t("drive.doc.speechWarning")}
        </p>
        {kind === "dictation" ? <p>{t("drive.doc.dictation.commands")}</p> : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("drive.cancel")}
          </Button>
          <Button
            onClick={() => {
              acceptSpeechNotice(kind);
              onAccept();
            }}
          >
            {t(`drive.doc.${kind}.accept`)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** The line at the bottom of the page: what is being heard or read, or what went wrong. */
function StatusPill({
  error,
  text,
  onDismiss,
}: {
  error: string | null;
  text: string;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-[60] max-w-xl -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-xl ${
        error
          ? "border-somnus-danger/40 bg-[#2a1215] text-somnus-danger"
          : "border-white/10 bg-[#0f1528] text-somnus-text"
      }`}
    >
      {error ? (
        <span className="flex items-center gap-3">
          {error}
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("ui.close")}
            className="rounded p-0.5 hover:bg-white/10"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
          <span className="truncate">{text}</span>
        </span>
      )}
    </div>,
    document.body,
  );
}

/** Dictation into the page, through AssemblyAI (EU). */
export function DictationButton({
  editor,
  voice,
  lang,
}: {
  editor: Editor;
  voice: VoiceBinding;
  lang: DriveSpeechLang;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "starting" | "listening">("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<DictationError | "unsupported" | null>(null);
  const [asking, setAsking] = useState(false);
  const session = useRef<{ stop: () => void } | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      session.current?.stop();
    },
    [],
  );

  async function begin() {
    setError(null);
    setState("starting");
    const started = await startDictation({
      open: () => voice.dictation(lang),
      onInterim: (text) => alive.current && setInterim(text),
      onFinal: (text) => insertDictation(editor, spokenText(text, lang)),
      onError: (e) => alive.current && setError(e),
      onStop: () => {
        session.current = null;
        if (!alive.current) return;
        setState("idle");
        setInterim("");
      },
    });
    if (!alive.current) {
      started?.stop();
      return;
    }
    session.current = started;
    if (started) setState("listening");
  }

  function toggle() {
    if (state !== "idle") {
      session.current?.stop();
      return;
    }
    if (!dictationSupported()) {
      setError("unsupported");
      return;
    }
    if (speechNoticeSeen("dictation")) void begin();
    else setAsking(true);
  }

  const active = state !== "idle";
  const label = active ? t("drive.doc.dictation.stop") : t("drive.doc.dictation.start");
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={active}
        onMouseDown={keepSelection}
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
          active
            ? "bg-red-500/20 text-red-300"
            : "text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
        }`}
      >
        <Icon name="mic" className={`h-[18px] w-[18px] ${active ? "animate-pulse" : ""}`} />
        {t("drive.doc.dictation.label")}
      </button>
      {active || error ? (
        <StatusPill
          error={error ? t(`drive.doc.dictation.error.${error}`) : null}
          text={
            interim ||
            t(
              state === "starting"
                ? "drive.doc.dictation.starting"
                : "drive.doc.dictation.listening",
            )
          }
          onDismiss={() => setError(null)}
        />
      ) : null}
      {asking ? (
        <SpeechNotice
          kind="dictation"
          onClose={() => setAsking(false)}
          onAccept={() => {
            setAsking(false);
            void begin();
          }}
        />
      ) : null}
    </>
  );
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The player at the bottom of the page while a document is read: where it is
 * (part n of m, and time within the part), pause and continue, back and
 * forward, a timeline to jump with, and stop.
 */
function ReaderBar({ state, reader }: { state: ReaderState; reader: Reader }) {
  const { t } = useTranslation();
  const part = Math.min(state.index + 1, state.total);
  const within = state.duration > 0 ? Math.min(1, state.position / state.duration) : 0;
  const control =
    "rounded-full p-2 text-somnus-text hover:bg-white/10 disabled:opacity-40 disabled:hover:bg-transparent";
  return createPortal(
    <section
      aria-label={t("drive.doc.readAloud.player")}
      className="fixed bottom-4 left-1/2 z-[60] w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-[#0f1528]/95 px-4 py-3 shadow-2xl backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={control}
          onClick={() => reader.seek(state.index - 1)}
          disabled={state.index === 0}
          aria-label={t("drive.doc.readAloud.previous")}
          title={t("drive.doc.readAloud.previous")}
        >
          <Icon name="skipBack" className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="rounded-full bg-somnus-primary-strong p-2.5 text-white hover:brightness-110"
          onClick={() => (state.playing ? reader.pause() : reader.resume())}
          aria-label={
            state.playing ? t("drive.doc.readAloud.pause") : t("drive.doc.readAloud.resume")
          }
          title={state.playing ? t("drive.doc.readAloud.pause") : t("drive.doc.readAloud.resume")}
        >
          <Icon name={state.playing ? "pause" : "play"} className="h-5 w-5" />
        </button>
        <button
          type="button"
          className={control}
          onClick={() => reader.seek(state.index + 1)}
          disabled={state.index >= state.total - 1}
          aria-label={t("drive.doc.readAloud.next")}
          title={t("drive.doc.readAloud.next")}
        >
          <Icon name="skipForward" className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 px-2">
          <div className="flex justify-between text-xs text-somnus-subtle">
            <span>{t("drive.doc.readAloud.part", { part, total: state.total })}</span>
            <span aria-live="off">
              {state.loading
                ? t("drive.doc.readAloud.loading")
                : `${clock(state.position)} / ${clock(state.duration)}`}
            </span>
          </div>
          <label className="mt-1 block">
            <span className="sr-only">{t("drive.doc.readAloud.timeline")}</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, state.total - 1)}
              step={1}
              value={state.index}
              onChange={(event) => reader.seek(Number(event.target.value))}
              aria-valuetext={t("drive.doc.readAloud.part", { part, total: state.total })}
              className="w-full accent-[#437ef7]"
            />
          </label>
          <div aria-hidden="true" className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-somnus-primary" style={{ width: `${within * 100}%` }} />
          </div>
        </div>
        <button
          type="button"
          className={control}
          onClick={() => reader.stop()}
          aria-label={t("drive.doc.readAloud.close")}
          title={t("drive.doc.readAloud.close")}
        >
          <Icon name="x" className="h-5 w-5" />
        </button>
      </div>
    </section>,
    document.body,
  );
}

/**
 * Reads the document aloud with Google's voice: the selection if there is one,
 * otherwise from the paragraph the caret is in to the end. The passage being
 * read is highlighted and kept in view.
 */
export function ReadAloudButton({
  voice,
  lang,
  collect,
  onPassage,
  onWord,
}: {
  voice: VoiceBinding;
  lang: DriveSpeechLang;
  /** What to read, decided when reading starts; a preview may need a moment. */
  collect: () => Passage[] | Promise<Passage[]>;
  /** Highlights a passage (null: none), and the word being spoken in it. */
  onPassage: (passage: Passage | null) => void;
  onWord: (passage: Passage, word: [number, number] | null) => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<ReaderState | null>(null);
  const [error, setError] = useState<ReadAloudError | null>(null);
  const [asking, setAsking] = useState(false);
  const reader = useRef<Reader | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
      reader.current?.stop();
    },
    [],
  );

  async function begin() {
    setError(null);
    const passages = await collect();
    if (passages.length === 0 || !alive.current) return;
    reader.current = startReader({
      passages,
      speak: (text) => voice.readAloud(text, lang),
      onState: (next) => alive.current && setState(next),
      onPassage,
      onWord,
      onError: (e) => alive.current && setError(e),
      onStop: () => {
        reader.current = null;
        if (alive.current) setState(null);
      },
    });
  }

  function toggle() {
    if (reader.current) {
      reader.current.stop();
      return;
    }
    if (speechNoticeSeen("readAloud")) void begin();
    else setAsking(true);
  }

  const reading = state !== null;
  const label = reading ? t("drive.doc.readAloud.stop") : t("drive.doc.readAloud.start");
  return (
    <>
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={reading}
        onMouseDown={keepSelection}
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
          reading
            ? "bg-somnus-primary/20 text-somnus-primary"
            : "text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
        }`}
      >
        <Icon name="speaker" className="h-[18px] w-[18px]" />
        {t("drive.doc.readAloud.label")}
      </button>
      {state && reader.current ? <ReaderBar state={state} reader={reader.current} /> : null}
      {error ? (
        <StatusPill
          error={t(`drive.doc.readAloud.error.${error}`)}
          text=""
          onDismiss={() => setError(null)}
        />
      ) : null}
      {asking ? (
        <SpeechNotice
          kind="readAloud"
          onClose={() => setAsking(false)}
          onAccept={() => {
            setAsking(false);
            void begin();
          }}
        />
      ) : null}
    </>
  );
}

function scrollToPosition(editor: Editor, pos: number, block: ScrollLogicalPosition) {
  const node = editor.view.nodeDOM(pos) ?? editor.view.domAtPos(pos).node;
  const element = node instanceof HTMLElement ? node : node?.parentElement;
  element?.scrollIntoView?.({ block, behavior: "smooth" });
}

/** The language picker for voice, shared by the editor and the previews. */
export function VoiceLanguage({
  lang,
  onChange,
}: {
  lang: DriveSpeechLang;
  onChange: (lang: DriveSpeechLang) => void;
}) {
  const { t } = useTranslation();
  return (
    <label>
      <span className="sr-only">{t("drive.doc.voiceLang.label")}</span>
      <select
        value={lang}
        onChange={(event) => onChange(langOf(event.target.value))}
        title={t("drive.doc.voiceLang.label")}
        className="rounded-md border border-white/10 bg-somnus-background px-1 py-1 text-sm text-somnus-text"
      >
        {(["es", "ca", "en", "fr"] as const).map((code) => (
          <option key={code} value={code}>
            {t(`drive.doc.voiceLang.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The language to dictate and read in, which may differ from the console's:
 * a document in Catalan, written by someone whose console is in Spanish. The
 * names are each language's own.
 */
export function VoiceControls({ editor, voice }: { editor: Editor; voice: VoiceBinding }) {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<DriveSpeechLang>(() => langOf(i18n.language));
  return (
    <>
      <VoiceLanguage lang={lang} onChange={setLang} />
      <DictationButton editor={editor} voice={voice} lang={lang} />
      <ReadAloudButton
        voice={voice}
        lang={lang}
        collect={() => {
          const { from, to, empty } = editor.state.selection;
          return empty
            ? passagesFrom(editor.state.doc, from)
            : passagesOfSelection(editor.state.doc, from, to);
        }}
        onPassage={(passage) => {
          if (editor.isDestroyed) return;
          editor.view.dispatch(editor.state.tr.setMeta(readingKey, passageMeta(passage)));
          if (passage) scrollToPosition(editor, passage.from, "center");
        }}
        onWord={(passage, word) => {
          if (editor.isDestroyed) return;
          const range = word && wordRange(passage, word[0], word[1]);
          editor.view.dispatch(editor.state.tr.setMeta(readingKey, wordMeta(range)));
          // A long paragraph: keep the spoken word on screen as it moves down.
          if (range) scrollToPosition(editor, range[0], "nearest");
        }}
      />
    </>
  );
}
