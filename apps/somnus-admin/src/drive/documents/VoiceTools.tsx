import type {
  DriveDictationSession,
  DriveReadAloudResult,
  DriveSpeechLang,
} from "@somnus/api-contracts";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Icon } from "../../components/ui/Icon.js";
import { Modal } from "../../components/ui/ui.js";
import { docBlocks } from "../notes/note-marks.js";
import {
  acceptSpeechNotice,
  type DictationError,
  dictationSupported,
  insertDictation,
  speechNoticeSeen,
  spokenText,
  startDictation,
} from "./dictation.js";
import { passagesOf, type ReadAloudError, startReadAloud } from "./read-aloud.js";

/** Our two voice services, as the Drive reaches them (owner decision 2026-11-02). */
export type VoiceBinding = {
  dictation: (lang: DriveSpeechLang) => Promise<DriveDictationSession>;
  readAloud: (text: string, lang: DriveSpeechLang) => Promise<DriveReadAloudResult>;
};

const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();

function langOf(language: string): DriveSpeechLang {
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
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-40 max-w-xl -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-xl ${
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
    </div>
  );
}

/** Dictation into the page, through AssemblyAI (EU). */
export function DictationButton({ editor, voice }: { editor: Editor; voice: VoiceBinding }) {
  const { t, i18n } = useTranslation();
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
    const lang = langOf(i18n.language);
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

/**
 * Reads the document aloud with Google's voice: the selection if there is one,
 * otherwise from the paragraph the caret is in to the end.
 */
export function ReadAloudButton({ editor, voice }: { editor: Editor; voice: VoiceBinding }) {
  const { t, i18n } = useTranslation();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<ReadAloudError | null>(null);
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

  function begin() {
    setError(null);
    const { from, to, empty } = editor.state.selection;
    let texts: string[];
    if (!empty) {
      texts = editor.state.doc.textBetween(from, to, "\n", " ").split("\n");
    } else {
      const blocks = docBlocks(editor.state.doc);
      const at = blocks.findIndex((b) => from >= b.pos && from < b.pos + b.size);
      texts = blocks.slice(Math.max(at, 0)).map((b) => b.text);
    }
    const passages = passagesOf(texts);
    if (passages.length === 0) return;
    const lang = langOf(i18n.language);
    setReading(true);
    session.current = startReadAloud({
      passages,
      speak: (text) => voice.readAloud(text, lang),
      onPassage: () => {},
      onError: (e) => alive.current && setError(e),
      onStop: () => {
        session.current = null;
        if (alive.current) setReading(false);
      },
    });
  }

  function toggle() {
    if (reading) {
      session.current?.stop();
      return;
    }
    if (speechNoticeSeen("readAloud")) begin();
    else setAsking(true);
  }

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
            begin();
          }}
        />
      ) : null}
    </>
  );
}
