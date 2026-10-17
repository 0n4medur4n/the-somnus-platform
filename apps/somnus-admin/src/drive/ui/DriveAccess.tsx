import type { DriveAccount } from "@somnus/api-contracts";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import { edge } from "../../lib/edge.js";
import {
  changePassphrase,
  createAccount,
  recoverAccount,
  type UnlockedAccount,
  unlockWithPassphrase,
} from "../crypto.js";
import {
  Fingerprint,
  MIN_PASSPHRASE_LENGTH,
  Notice,
  passphraseStrength,
  useDriveTask,
} from "./drive-ui.js";

/** What every access screen hands back once the Drive is open. */
export type Opened = { account: DriveAccount; me: UnlockedAccount; recoveryCode?: string };

function usePassphrasePair() {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const error =
    value.length < MIN_PASSPHRASE_LENGTH
      ? t("drive.setup.tooShort")
      : value !== confirm
        ? t("drive.setup.mismatch")
        : null;
  return { value, setValue, confirm, setConfirm, touched, setTouched, error };
}

function PassphrasePair({
  pair,
  label,
  confirmLabel,
  autoFocus,
}: {
  pair: ReturnType<typeof usePassphrasePair>;
  label: string;
  confirmLabel: string;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const strength = passphraseStrength(pair.value);
  return (
    <>
      <Field
        label={label}
        hint={t("drive.setup.passphraseHint")}
        type="password"
        autoComplete="new-password"
        autoFocus={autoFocus}
        value={pair.value}
        onChange={(e) => pair.setValue(e.target.value)}
      />
      {pair.value.length > 0 ? (
        <p
          className={`text-sm ${strength === "strong" ? "text-somnus-success" : strength === "fair" ? "text-somnus-subtle" : "text-somnus-danger"}`}
        >
          {t(`drive.setup.strength.${strength}`)}
        </p>
      ) : null}
      <Field
        label={confirmLabel}
        type="password"
        autoComplete="new-password"
        value={pair.confirm}
        onChange={(e) => pair.setConfirm(e.target.value)}
        {...(pair.touched && pair.error ? { error: pair.error } : {})}
      />
    </>
  );
}

export function DriveSetup({ onOpened }: { onOpened: (opened: Opened) => void }) {
  const { t } = useTranslation();
  const pair = usePassphrasePair();
  const task = useDriveTask();

  async function submit(event: FormEvent) {
    event.preventDefault();
    pair.setTouched(true);
    if (pair.error) return;
    const result = await task.run(async () => {
      const created = await createAccount(pair.value);
      const account = await edge.drive.enroll(created.request);
      return { account, me: await created.unlock(account), recoveryCode: created.recoveryCode };
    });
    if (result) onOpened(result);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h2 className="text-xl font-semibold text-somnus-text">{t("drive.setup.heading")}</h2>
      <p className="text-somnus-text">{t("drive.setup.intro")}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-somnus-subtle">
        <li>{t("drive.setup.point1")}</li>
        <li>{t("drive.setup.point2")}</li>
        <li>{t("drive.setup.point3")}</li>
      </ul>
      <PassphrasePair
        pair={pair}
        label={t("drive.setup.passphrase")}
        confirmLabel={t("drive.setup.confirm")}
        autoFocus
      />
      {task.error ? <Notice tone="danger">{task.error}</Notice> : null}
      <Button type="submit" disabled={task.busy}>
        {task.busy ? t("drive.setup.creating") : t("drive.setup.create")}
      </Button>
    </form>
  );
}

/** Shown once, after setup and after a recovery. The code is never stored by the console. */
export function RecoveryKit({ code, onDone }: { code: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function download() {
    const text = `${t("drive.recovery.fileTitle")}\n\n${code}\n\n${t("drive.recovery.fileWarning")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "the-somnus-drive-recovery-code.txt";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <section aria-labelledby="recovery-heading" className="flex flex-col gap-4">
      <h2 id="recovery-heading" className="text-xl font-semibold text-somnus-text">
        {t("drive.recovery.heading")}
      </h2>
      <p className="text-somnus-text">{t("drive.recovery.intro")}</p>
      <p
        data-testid="recovery-code"
        className="rounded-lg border border-somnus-primary/40 bg-somnus-background p-4 text-center font-mono text-lg tracking-widest text-somnus-text"
      >
        {code}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => undefined,
            )
          }
        >
          {copied ? t("drive.recovery.copied") : t("drive.recovery.copy")}
        </Button>
        <Button variant="secondary" onClick={download}>
          {t("drive.recovery.download")}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-somnus-text">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t("drive.recovery.confirm")}
      </label>
      <Button disabled={!saved} onClick={onDone}>
        {t("drive.recovery.continue")}
      </Button>
    </section>
  );
}

type UnlockMode = "passphrase" | "recover" | "reset";

export function DriveUnlock({
  account,
  notice,
  onOpened,
}: {
  account: DriveAccount;
  notice?: string | null;
  onOpened: (opened: Opened) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<UnlockMode>("passphrase");
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const [resetWord, setResetWord] = useState("");
  const pair = usePassphrasePair();
  const task = useDriveTask();

  async function open(event: FormEvent) {
    event.preventDefault();
    const result = await task.run(async () => ({
      account,
      me: await unlockWithPassphrase(account, passphrase),
    }));
    if (result) onOpened(result);
    else setPassphrase("");
  }

  async function recover(event: FormEvent) {
    event.preventDefault();
    pair.setTouched(true);
    if (pair.error) return;
    const result = await task.run(async () => {
      const recovered = await recoverAccount(account, code, pair.value);
      const updated = await edge.drive.rewrap(recovered.rewrap);
      return { account: updated, me: recovered.unlocked, recoveryCode: recovered.recoveryCode };
    });
    if (result) onOpened(result);
  }

  async function reset(event: FormEvent) {
    event.preventDefault();
    pair.setTouched(true);
    if (pair.error || resetWord !== t("drive.reset.confirmWord")) return;
    const result = await task.run(async () => {
      const created = await createAccount(pair.value);
      const updated = await edge.drive.reset(created.request);
      return {
        account: updated,
        me: await created.unlock(updated),
        recoveryCode: created.recoveryCode,
      };
    });
    if (result) onOpened(result);
  }

  if (mode === "recover") {
    return (
      <form onSubmit={recover} className="flex flex-col gap-4" noValidate>
        <h2 className="text-xl font-semibold text-somnus-text">{t("drive.recover.heading")}</h2>
        <Field
          label={t("drive.recover.code")}
          hint={t("drive.recover.codeHint")}
          autoComplete="off"
          spellCheck={false}
          className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2 font-mono tracking-widest text-somnus-text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <PassphrasePair
          pair={pair}
          label={t("drive.recover.newPassphrase")}
          confirmLabel={t("drive.recover.confirm")}
        />
        {task.error ? <Notice tone="danger">{task.error}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={task.busy}>
            {task.busy ? t("drive.working") : t("drive.recover.submit")}
          </Button>
          <Button variant="secondary" onClick={() => setMode("passphrase")}>
            {t("drive.back")}
          </Button>
        </div>
      </form>
    );
  }

  if (mode === "reset") {
    return (
      <form onSubmit={reset} className="flex flex-col gap-4" noValidate>
        <h2 className="text-xl font-semibold text-somnus-danger">{t("drive.reset.heading")}</h2>
        <Notice tone="danger">{t("drive.reset.warning")}</Notice>
        <PassphrasePair
          pair={pair}
          label={t("drive.recover.newPassphrase")}
          confirmLabel={t("drive.recover.confirm")}
        />
        <Field
          label={t("drive.reset.confirmLabel")}
          autoComplete="off"
          value={resetWord}
          onChange={(e) => setResetWord(e.target.value)}
        />
        {task.error ? <Notice tone="danger">{task.error}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            className="bg-somnus-danger text-somnus-background"
            disabled={task.busy || resetWord !== t("drive.reset.confirmWord")}
          >
            {task.busy ? t("drive.working") : t("drive.reset.submit")}
          </Button>
          <Button variant="secondary" onClick={() => setMode("passphrase")}>
            {t("drive.back")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={open} className="flex flex-col gap-4" noValidate>
      <h2 className="text-xl font-semibold text-somnus-text">{t("drive.unlock.heading")}</h2>
      {notice ? <Notice tone="info">{notice}</Notice> : null}
      <p className="text-somnus-subtle">{t("drive.unlock.intro")}</p>
      <Field
        label={t("drive.unlock.passphrase")}
        type="password"
        autoComplete="current-password"
        autoFocus
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      {task.error ? <Notice tone="danger">{task.error}</Notice> : null}
      <Button type="submit" disabled={task.busy || passphrase.length === 0}>
        {task.busy ? t("drive.unlock.opening") : t("drive.unlock.open")}
      </Button>
      <div className="flex flex-col items-start gap-2 text-sm">
        <button
          type="button"
          className="text-somnus-primary underline"
          onClick={() => {
            task.setError(null);
            setMode("recover");
          }}
        >
          {t("drive.unlock.forgot")}
        </button>
        <button
          type="button"
          className="text-somnus-subtle underline"
          onClick={() => {
            task.setError(null);
            setMode("reset");
          }}
        >
          {t("drive.unlock.lostEverything")}
        </button>
      </div>
    </form>
  );
}

export function ChangePassphrase({
  account,
  onChanged,
  onCancel,
}: {
  account: DriveAccount;
  onChanged: (account: DriveAccount) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const pair = usePassphrasePair();
  const task = useDriveTask();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    pair.setTouched(true);
    if (pair.error) return;
    const updated = await task.run(async () => {
      const passphraseWrap = await changePassphrase(account, current, pair.value);
      return edge.drive.rewrap({ passphraseWrap });
    });
    if (updated) {
      setDone(true);
      onChanged(updated);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-lg border border-somnus-subtle/20 p-4"
      noValidate
    >
      <h3 className="text-lg font-medium text-somnus-text">
        {t("drive.passphraseChange.heading")}
      </h3>
      <Field
        label={t("drive.passphraseChange.current")}
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <PassphrasePair
        pair={pair}
        label={t("drive.passphraseChange.next")}
        confirmLabel={t("drive.passphraseChange.confirm")}
      />
      {task.error ? <Notice tone="danger">{task.error}</Notice> : null}
      {done ? <Notice tone="success">{t("drive.passphraseChange.done")}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={task.busy}>
          {task.busy ? t("drive.working") : t("drive.passphraseChange.submit")}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t("drive.close")}
        </Button>
      </div>
    </form>
  );
}

export function OwnFingerprint({ fingerprint }: { fingerprint: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium text-somnus-text">{t("drive.yourFingerprint")}</p>
      <Fingerprint value={fingerprint} />
      <p className="text-xs text-somnus-subtle">{t("drive.fingerprintHint")}</p>
    </div>
  );
}
