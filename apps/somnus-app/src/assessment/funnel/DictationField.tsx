import { type DriveSpeechLang, findIdentifyingData } from "@somnus/api-contracts";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { edge } from "../../lib/edge.js";
import {
  acceptDictationNotice,
  appendDictation,
  type DictationError,
  dictationNoticeSeen,
  dictationSupported,
  startDictation,
} from "./dictation.js";

const LANGS = ["es", "ca", "en", "fr"] as const;

function langOf(language: string): DriveSpeechLang {
  const base = language.slice(0, 2).toLowerCase();
  return base === "en" || base === "ca" || base === "fr" ? base : "es";
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="none">
      <path
        d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The free-text box with a microphone. While the person speaks, the words
 * appear in the box; a finished sentence is kept and can be edited.
 */
export function DictationField({
  sessionId,
  value,
  onChange,
  label,
  required,
  maxLength,
  onListeningChange,
}: {
  sessionId: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  required: boolean;
  maxLength: number;
  onListeningChange: (listening: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [lang, setLang] = useState<DriveSpeechLang>(() => langOf(i18n.language));
  const [state, setState] = useState<"idle" | "starting" | "listening">("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<DictationError | "unsupported" | null>(null);
  const [asking, setAsking] = useState(false);
  const session = useRef<{ stop: () => void } | null>(null);
  const alive = useRef(true);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(
    () => () => {
      alive.current = false;
      session.current?.stop();
    },
    [],
  );

  useEffect(() => {
    onListeningChange(state !== "idle");
  }, [state, onListeningChange]);

  const listening = state !== "idle";
  const shown = interim
    ? `${value}${value && !/\s$/.test(value) ? " " : ""}${interim}`.slice(0, maxLength)
    : value;
  const warning = findIdentifyingData(shown).length > 0;

  async function begin() {
    setError(null);
    setState("starting");
    const started = await startDictation({
      open: () => edge.dictateFunnel(sessionId, lang),
      onInterim: (text) => alive.current && setInterim(text),
      onFinal: (text) => {
        if (!alive.current) return;
        onChange(appendDictation(valueRef.current, text, lang));
      },
      onError: (kind) => alive.current && setError(kind),
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
    if (dictationNoticeSeen()) void begin();
    else setAsking(true);
  }

  const buttonLabel = listening ? t("funnel.dictation.stop") : t("funnel.dictation.start");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <label>
            <span className="sr-only">{t("funnel.dictation.lang")}</span>
            <select
              value={lang}
              disabled={listening}
              onChange={(event) => setLang(langOf(event.target.value))}
              className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-2 py-1 text-sm"
            >
              {LANGS.map((code) => (
                <option key={code} value={code}>
                  {t(`funnel.dictation.langs.${code}`)}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            aria-pressed={listening}
            onClick={toggle}
            className={listening ? "text-somnus-danger" : undefined}
          >
            <MicIcon className={`mr-2 h-4 w-4 ${listening ? "animate-pulse" : ""}`} />
            {buttonLabel}
          </Button>
        </div>
      </div>
      <textarea
        id={id}
        value={shown}
        maxLength={maxLength}
        rows={5}
        required={required}
        readOnly={listening}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
        className="w-full rounded-lg border border-somnus-muted/40 bg-somnus-surface px-3 py-2.5 text-base"
      />
      <p
        id={`${id}-hint`}
        className={warning ? "text-somnus-danger" : "text-sm text-somnus-subtle"}
        role={warning || error ? "alert" : listening ? "status" : undefined}
      >
        {warning
          ? t("funnel.text.identifying")
          : error
            ? t(`funnel.dictation.error.${error}`)
            : listening
              ? interim ||
                t(state === "starting" ? "funnel.dictation.starting" : "funnel.dictation.listening")
              : t("funnel.text.hint")}
      </p>
      {asking ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-notice`}
          className="flex flex-col gap-3 rounded-lg border border-somnus-muted/40 bg-somnus-surface p-4 text-sm"
        >
          <h2 id={`${id}-notice`} className="font-medium">
            {t("funnel.dictation.noticeTitle")}
          </h2>
          <p>{t("funnel.dictation.notice")}</p>
          <p>{t("funnel.dictation.warning")}</p>
          <p>{t("funnel.dictation.commands")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t("funnel.dictation.cancel")}
            </Button>
            <Button
              onClick={() => {
                acceptDictationNotice();
                setAsking(false);
                void begin();
              }}
            >
              {t("funnel.dictation.accept")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
