import type { DriveAccount } from "@somnus/api-contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import { ApiRequestError } from "../../lib/api.js";
import { edge } from "../../lib/edge.js";
import { type DriveFolderView, DriveSession, type DriveShareEntry } from "../drive-session.js";
import {
  ChangePassphrase,
  DriveSetup,
  DriveUnlock,
  type Opened,
  OwnFingerprint,
  RecoveryKit,
} from "./DriveAccess.js";
import { DriveFolder } from "./DriveFolder.js";
import { DriveGuide } from "./DriveGuide.js";
import { LockIcon, Notice, useDriveTask } from "./drive-ui.js";

/** Idle time after which the Drive forgets its keys. */
export const DRIVE_IDLE_LOCK_MS = 15 * 60 * 1000;

type Phase =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "setup" }
  | { kind: "locked"; account: DriveAccount; notice: string | null }
  | { kind: "recoveryKit"; code: string; account: DriveAccount; session: DriveSession }
  | { kind: "open"; account: DriveAccount; session: DriveSession };

/**
 * The staff Drive (ADR 0019). Keys live in this component's memory and nowhere
 * else: locking, signing out, closing the tab or 15 idle minutes drop them, and
 * the passphrase is needed again. Nothing is written to browser storage.
 */
export function DriveScreen() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [guide, setGuide] = useState(false);
  const sessionRef = useRef<DriveSession | null>(null);

  const load = useCallback(async (notice: string | null = null) => {
    try {
      const account = await edge.drive.account();
      setPhase({ kind: "locked", account, notice });
    } catch (error) {
      if (error instanceof ApiRequestError && error.reason === "drive_account_missing") {
        setPhase({ kind: "setup" });
      } else {
        setPhase({ kind: "error" });
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lock = useCallback(
    (notice: string | null = null) => {
      sessionRef.current?.close();
      sessionRef.current = null;
      void load(notice);
    },
    [load],
  );

  // Leaving the Drive section (or signing out) drops the keys.
  useEffect(
    () => () => {
      sessionRef.current?.close();
      sessionRef.current = null;
    },
    [],
  );

  // Auto-lock after DRIVE_IDLE_LOCK_MS without a key press or pointer action.
  const isOpen = phase.kind === "open" || phase.kind === "recoveryKit";
  useEffect(() => {
    if (!isOpen) return;
    let timer = window.setTimeout(() => lock(t("drive.locked")), DRIVE_IDLE_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lock(t("drive.locked")), DRIVE_IDLE_LOCK_MS);
    };
    const events = ["pointerdown", "keydown"] as const;
    for (const name of events) window.addEventListener(name, reset);
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, reset);
    };
  }, [isOpen, lock, t]);

  async function opened(result: Opened) {
    const session = await DriveSession.open(edge.drive, result.account, result.me);
    sessionRef.current = session;
    setPhase(
      result.recoveryCode
        ? { kind: "recoveryKit", code: result.recoveryCode, account: result.account, session }
        : { kind: "open", account: result.account, session },
    );
  }

  return (
    <section aria-labelledby="drive-title" className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="drive-title"
            className="flex items-center gap-2 text-2xl font-semibold text-somnus-text"
          >
            <LockIcon />
            {t("drive.title")}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setGuide((g) => !g)} aria-expanded={guide}>
              {t("drive.guide")}
            </Button>
            {phase.kind === "open" ? (
              <Button variant="secondary" onClick={() => lock()}>
                {t("drive.lock")}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-somnus-subtle">{t("drive.subtitle")}</p>
        <Notice tone="info">{t("drive.notForPatients")}</Notice>
      </header>

      {guide ? <DriveGuide onClose={() => setGuide(false)} /> : null}

      {phase.kind === "loading" ? <p className="text-somnus-subtle">{t("drive.loading")}</p> : null}
      {phase.kind === "error" ? <Notice tone="danger">{t("errors.generic")}</Notice> : null}
      {phase.kind === "setup" ? <DriveSetup onOpened={(r) => void opened(r)} /> : null}
      {phase.kind === "locked" ? (
        <DriveUnlock
          account={phase.account}
          notice={phase.notice}
          onOpened={(r) => void opened(r)}
        />
      ) : null}
      {phase.kind === "recoveryKit" ? (
        <RecoveryKit
          code={phase.code}
          onDone={() => setPhase({ kind: "open", account: phase.account, session: phase.session })}
        />
      ) : null}
      {phase.kind === "open" ? (
        <DriveHome
          session={phase.session}
          account={phase.account}
          onAccountChanged={(account) => setPhase({ ...phase, account })}
        />
      ) : null}
    </section>
  );
}

/** The open Drive: the list of shared folders, or one of them. */
function DriveHome({
  session,
  account,
  onAccountChanged,
}: {
  session: DriveSession;
  account: DriveAccount;
  onAccountChanged: (account: DriveAccount) => void;
}) {
  const { t } = useTranslation();
  const task = useDriveTask();
  const { run } = task;
  const [shares, setShares] = useState<DriveShareEntry[] | null>(null);
  const [view, setView] = useState<DriveFolderView | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState(false);

  const refresh = useCallback(async () => {
    const list = await run(() => session.listShares());
    if (list) setShares(list);
  }, [session, run]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openShare(shareId: string) {
    const opened = await task.run(() => session.openShare(shareId));
    if (opened) setView(opened);
  }

  async function reload() {
    if (!view) return;
    const opened = await task.run(() => session.openShare(view.shareId));
    if (opened) setView(opened);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const ok = await task.run(() => session.createShare(name));
    if (ok !== null) {
      setNewName("");
      setCreating(false);
      await refresh();
    }
  }

  if (view) {
    return (
      <DriveFolder
        session={session}
        view={view}
        onReload={reload}
        onExit={() => {
          setView(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/15 p-4">
        <OwnFingerprint fingerprint={session.me.fingerprint} />
        <div>
          <Button variant="secondary" onClick={() => setChanging((c) => !c)}>
            {t("drive.changePassphrase")}
          </Button>
        </div>
        {changing ? (
          <ChangePassphrase
            account={account}
            onChanged={onAccountChanged}
            onCancel={() => setChanging(false)}
          />
        ) : null}
      </div>

      <section aria-labelledby="drive-shares-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="drive-shares-heading" className="text-lg font-medium text-somnus-text">
            {t("drive.shares.heading")}
          </h3>
          <Button onClick={() => setCreating((c) => !c)}>{t("drive.shares.new")}</Button>
        </div>

        {creating ? (
          <form
            onSubmit={create}
            className="flex flex-col gap-2 rounded-lg border border-somnus-subtle/20 p-4"
          >
            <Field
              label={t("drive.shares.newName")}
              value={newName}
              maxLength={200}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="submit" disabled={task.busy || !newName.trim()}>
                {task.busy ? t("drive.working") : t("drive.shares.create")}
              </Button>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                {t("drive.cancel")}
              </Button>
            </div>
          </form>
        ) : null}

        {task.error ? <Notice tone="danger">{task.error}</Notice> : null}
        {shares === null && task.busy ? (
          <p className="text-somnus-subtle">{t("drive.loading")}</p>
        ) : null}
        {shares?.length === 0 ? (
          <p className="text-somnus-subtle">{t("drive.shares.empty")}</p>
        ) : null}

        <ul className="grid gap-3 sm:grid-cols-2">
          {shares?.map((share) => (
            <li key={share.shareId}>
              <button
                type="button"
                disabled={share.name === null || task.busy}
                onClick={() => void openShare(share.shareId)}
                className="flex w-full flex-col items-start gap-1 rounded-lg border border-somnus-subtle/15 bg-somnus-surface p-4 text-left hover:border-somnus-primary/60 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="font-medium text-somnus-text">
                  {share.name ?? t("drive.shares.unreadable")}
                </span>
                {share.problem ? (
                  <span className="text-sm text-somnus-danger">
                    {t(`drive.problem.${share.problem}`)}
                  </span>
                ) : null}
                <span className="text-sm text-somnus-subtle">
                  {t(`drive.role.${share.role}`)} ·{" "}
                  {t("drive.shares.members", { count: share.memberCount })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
