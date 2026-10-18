import type { DriveAccount } from "@somnus/api-contracts";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui/Icon.js";
import { ApiRequestError } from "../../lib/api.js";
import { edge } from "../../lib/edge.js";
import { DriveSession } from "../drive-session.js";
import { DriveSetup, DriveUnlock, type Opened, RecoveryKit } from "./DriveAccess.js";
import { DriveWorkspace } from "./DriveWorkspace.js";
import { Notice } from "./drive-ui.js";

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

  const gateCard = (children: ReactNode) => (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-somnus-primary/10 text-somnus-primary">
          <Icon name="lock" className="h-7 w-7" />
        </span>
        <p className="max-w-md text-sm text-somnus-subtle">{t("drive.subtitle")}</p>
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-somnus-surface/80 p-6">
        {children}
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs text-somnus-subtle">
        <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("drive.notForPatients")}
      </p>
    </div>
  );

  if (phase.kind === "open") {
    return (
      <DriveWorkspace
        session={phase.session}
        account={phase.account}
        onAccountChanged={(account) => setPhase({ ...phase, account })}
        onLock={() => lock()}
      />
    );
  }

  return (
    <section aria-label={t("drive.title")}>
      {phase.kind === "loading" ? (
        <p className="text-center text-somnus-subtle">{t("drive.loading")}</p>
      ) : null}
      {phase.kind === "error" ? <Notice tone="danger">{t("errors.generic")}</Notice> : null}
      {phase.kind === "setup" ? gateCard(<DriveSetup onOpened={(r) => void opened(r)} />) : null}
      {phase.kind === "locked"
        ? gateCard(
            <DriveUnlock
              account={phase.account}
              notice={phase.notice}
              onOpened={(r) => void opened(r)}
            />,
          )
        : null}
      {phase.kind === "recoveryKit"
        ? gateCard(
            <RecoveryKit
              code={phase.code}
              onDone={() =>
                setPhase({ kind: "open", account: phase.account, session: phase.session })
              }
            />,
          )
        : null}
    </section>
  );
}
