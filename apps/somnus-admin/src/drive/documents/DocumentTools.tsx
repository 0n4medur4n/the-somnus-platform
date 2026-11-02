import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import { Modal } from "../../components/ui/ui.js";
import { PASSWORD_MIN_LENGTH } from "./doc-lock.js";

const keepSelection = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * A toolbar button that opens a palette of colours under it. Picking one, or
 * "none", applies it to the selection and closes the palette.
 */
export function ColorPicker({
  icon,
  label,
  colors,
  current,
  noneLabel,
  onPick,
  onNone,
}: {
  icon: IconName;
  label: string;
  colors: readonly string[];
  current: string | null;
  noneLabel: string;
  onPick: (color: string) => void;
  onNone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={keepSelection}
        onClick={() => setOpen((v) => !v)}
        className="flex flex-col items-center rounded-md px-1.5 pt-1 pb-0.5 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
      >
        <Icon name={icon} className="h-[16px] w-[16px]" />
        <span
          aria-hidden="true"
          className="mt-0.5 h-[3px] w-4 rounded-sm"
          style={{
            background: current ?? "transparent",
            outline: "1px solid rgba(255,255,255,.2)",
          }}
        />
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-30 mt-1 w-48 rounded-lg border border-white/10 bg-[#0f1528] p-2 shadow-xl">
          <div className="grid grid-cols-7 gap-1">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                onMouseDown={keepSelection}
                onClick={() => {
                  onPick(color);
                  setOpen(false);
                }}
                aria-label={t("drive.doc.tools.colorSwatch", { color })}
                aria-pressed={current === color}
                className={`h-5 w-5 rounded ${current === color ? "ring-2 ring-somnus-primary ring-offset-1 ring-offset-[#0f1528]" : "ring-1 ring-white/20"}`}
                style={{ background: color }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={keepSelection}
            onClick={() => {
              onNone();
              setOpen(false);
            }}
            className="mt-2 w-full rounded-md border border-white/10 px-2 py-1 text-xs text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
          >
            {noneLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Asks for a new password twice. `warning` says what is at stake: a lost
 * password cannot be recovered by anyone.
 */
export function PasswordDialog({
  title,
  intro,
  warning,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  intro: string;
  warning: string;
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(t("drive.doc.password.tooShort", { count: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== repeat) {
      setError(t("drive.doc.password.mismatch"));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <p className="text-sm text-somnus-subtle">{intro}</p>
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          {warning}
        </p>
        <Field
          label={t("drive.doc.password.new")}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Field
          label={t("drive.doc.password.repeat")}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          {...(error ? { error } : {})}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("drive.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("drive.working") : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The screen of a document with its own password, before it is opened. */
export function UnlockDocument({
  title,
  onUnlock,
  onBack,
}: {
  title: string;
  /** false when the password is wrong. */
  onUnlock: (password: string) => Promise<boolean>;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password) return;
    setBusy(true);
    const ok = await onUnlock(password);
    setBusy(false);
    if (!ok) setWrong(true);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 p-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 self-start rounded-lg px-2 py-1 text-sm text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
      >
        <Icon name="arrowLeft" className="h-4 w-4" />
        {t("drive.doc.back")}
      </button>
      <div className="flex items-center gap-3">
        <Icon name="lock" className="h-8 w-8 text-somnus-primary" />
        <div>
          <h1 className="text-lg font-semibold text-somnus-text">{title}</h1>
          <p className="text-sm text-somnus-subtle">{t("drive.doc.password.lockedIntro")}</p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field
          label={t("drive.doc.password.current")}
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setWrong(false);
          }}
          {...(wrong ? { error: t("drive.doc.password.wrong") } : {})}
        />
        <Button type="submit" disabled={busy || !password}>
          {busy ? t("drive.working") : t("drive.doc.password.open")}
        </Button>
      </form>
    </div>
  );
}
