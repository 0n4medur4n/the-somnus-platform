import { DRIVE_ROLES, type DriveRole } from "@somnus/api-contracts";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import type { DriveFolderView, DriveSession } from "../drive-session.js";
import { Fingerprint, Notice, TrustBadge, useDriveTask } from "./drive-ui.js";

/**
 * Who has access to a shared folder, and -- for owners -- sharing, roles,
 * removal (which rotates the folder key), renaming and deleting the folder.
 *
 * Fingerprints are shown wherever a key is about to be trusted: the point of
 * the panel is that "share with Ana" means Ana's key, not a key the server says
 * is Ana's.
 */
export function DriveMembers({
  session,
  view,
  onChanged,
  onLeft,
  onRename,
  onAppearance,
}: {
  session: DriveSession;
  view: DriveFolderView;
  onChanged: () => void;
  onLeft: () => void;
  /** Owners rename the shared folder in a dialog the workspace owns. */
  onRename: () => void;
  /** Owners choose the shared folder's colour and icon (owner decision 2026-10-29). */
  onAppearance?: () => void;
}) {
  const { t } = useTranslation();
  const task = useDriveTask();
  const isOwner = view.role === "owner";
  const memberIds = new Set(view.members.map((m) => m.userId));
  const candidates = session.colleagues().filter((c) => !memberIds.has(c.userId));
  const [chosen, setChosen] = useState("");
  const [role, setRole] = useState<DriveRole>("viewer");
  const [deleteName, setDeleteName] = useState("");
  const [checked, setChecked] = useState(false);
  const candidate = candidates.find((c) => c.userId === chosen);

  async function share(event: FormEvent) {
    event.preventDefault();
    if (!candidate) return;
    const ok = await task.run(async () => {
      // Confirmed out of band just now: remember it, so the member list shows
      // "verified" and a later key change stands out.
      if (checked && candidate.trust !== "verified") await session.markVerified(candidate.userId);
      return session.addMember(view, candidate.userId, role);
    });
    if (ok !== null) {
      setChosen("");
      setChecked(false);
      onChanged();
    }
  }

  async function act(operation: () => Promise<unknown>) {
    const ok = await task.run(operation);
    if (ok !== null) onChanged();
  }

  return (
    <section aria-label={t("drive.members.heading")} className="flex flex-col gap-4">
      {task.error ? <Notice tone="danger">{task.error}</Notice> : null}

      <ul className="flex flex-col gap-3">
        {view.members.map((member) => {
          const self = member.userId === session.me.userId;
          const fingerprint = session.fingerprintOf(member.userId);
          return (
            <li
              key={member.userId}
              className="flex flex-col gap-2 rounded-md border border-somnus-subtle/15 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-somnus-text">
                  {self ? t("drive.members.you") : member.email}
                </span>
                {self ? null : <TrustBadge trust={member.trust} />}
                {isOwner && !self ? (
                  <select
                    aria-label={t("drive.members.roleLabel")}
                    value={member.role}
                    disabled={task.busy}
                    onChange={(e) =>
                      void act(() =>
                        session.setRole(view, member.userId, e.target.value as DriveRole),
                      )
                    }
                    className="ml-auto rounded-md border border-somnus-muted/40 bg-somnus-background px-2 py-1 text-sm text-somnus-text"
                  >
                    {DRIVE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {t(`drive.role.${r}`)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="ml-auto text-sm text-somnus-subtle">
                    {t(`drive.role.${member.role}`)}
                  </span>
                )}
              </div>
              {member.trust === "changed" ? (
                <Notice tone="danger">{t("drive.trustHelp.changed")}</Notice>
              ) : null}
              {!self && fingerprint ? (
                <details className="text-sm text-somnus-subtle">
                  <summary className="cursor-pointer">{t("drive.members.fingerprint")}</summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <Fingerprint value={fingerprint} />
                    <div className="flex flex-wrap gap-2">
                      {member.trust === "known" ? (
                        <Button
                          className="px-3 py-1.5 text-sm"
                          variant="secondary"
                          disabled={task.busy}
                          onClick={() => void act(() => session.markVerified(member.userId))}
                        >
                          {t("drive.members.markVerified")}
                        </Button>
                      ) : null}
                      {member.trust === "changed" ? (
                        <Button
                          className="px-3 py-1.5 text-sm"
                          variant="secondary"
                          disabled={task.busy}
                          onClick={() => void act(() => session.acceptNewKey(member.userId))}
                        >
                          {t("drive.members.acceptNewKey")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </details>
              ) : null}
              {(isOwner && !self) || (self && view.members.length > 1) ? (
                <div>
                  <Button
                    className="px-3 py-1.5 text-sm"
                    variant="secondary"
                    disabled={task.busy}
                    onClick={() => {
                      if (!window.confirm(t("drive.members.removeConfirm"))) return;
                      void task
                        .run(() => session.removeMember(view, member.userId))
                        .then((ok) => {
                          if (ok === null) return;
                          if (self) onLeft();
                          else onChanged();
                        });
                    }}
                  >
                    {self ? t("drive.members.leave") : t("drive.members.remove")}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isOwner ? (
        <form
          onSubmit={share}
          className="flex flex-col gap-3 border-t border-somnus-subtle/15 pt-4"
        >
          <h4 className="font-medium text-somnus-text">{t("drive.members.add")}</h4>
          {candidates.length === 0 ? (
            <p className="text-sm text-somnus-subtle">{t("drive.members.noColleagues")}</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm text-somnus-text">
                {t("drive.members.colleague")}
                <select
                  value={chosen}
                  onChange={(e) => {
                    setChosen(e.target.value);
                    setChecked(false);
                  }}
                  className="rounded-md border border-somnus-muted/40 bg-somnus-background px-3 py-2 text-somnus-text"
                >
                  <option value="">{t("drive.members.chooseColleague")}</option>
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-somnus-text">
                {t("drive.members.roleLabel")}
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as DriveRole)}
                  className="rounded-md border border-somnus-muted/40 bg-somnus-background px-3 py-2 text-somnus-text"
                >
                  {DRIVE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`drive.role.${r}`)}
                    </option>
                  ))}
                </select>
              </label>
              {candidate ? (
                <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-somnus-background/60 p-3 text-sm text-somnus-subtle">
                  <p className="font-medium text-somnus-text">
                    {t("drive.members.fingerprintOf", { who: candidate.email })}
                  </p>
                  <Fingerprint value={candidate.fingerprint} />
                  <p>{t("drive.members.fingerprintExplain", { who: candidate.email })}</p>
                  <p className="text-xs">{t("drive.members.notRecoveryCode")}</p>
                  <TrustBadge trust={candidate.trust} />
                  {candidate.trust === "changed" ? (
                    <Notice tone="danger">{t("drive.trustHelp.changed")}</Notice>
                  ) : null}
                  {candidate.trust === "known" ? (
                    <label className="mt-1 flex items-start gap-2 text-somnus-text">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-somnus-primary"
                      />
                      <span>{t("drive.members.confirmMatches", { who: candidate.email })}</span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <Button
                className="px-3 py-1.5 text-sm"
                type="submit"
                disabled={task.busy || !candidate || candidate.trust === "changed"}
              >
                {task.busy ? t("drive.working") : t("drive.members.addSubmit")}
              </Button>
            </>
          )}
        </form>
      ) : null}

      {isOwner ? (
        <div className="flex flex-col gap-4 border-t border-somnus-subtle/15 pt-4">
          <div>
            <Button className="px-3 py-1.5 text-sm" variant="secondary" onClick={onRename}>
              {t("drive.members.renameFolder")}
            </Button>
            {onAppearance ? (
              <Button
                className="ml-2 px-3 py-1.5 text-sm"
                variant="secondary"
                onClick={onAppearance}
              >
                {t("drive.appearance.menu")}
              </Button>
            ) : null}
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (deleteName !== view.name) return;
              void task
                .run(() => session.deleteShare(view))
                .then((ok) => {
                  if (ok !== null) onLeft();
                });
            }}
          >
            <h4 className="font-medium text-somnus-danger">{t("drive.members.deleteFolder")}</h4>
            <Field
              label={t("drive.members.deleteConfirmLabel")}
              value={deleteName}
              autoComplete="off"
              onChange={(e) => setDeleteName(e.target.value)}
            />
            <div>
              <Button
                type="submit"
                className="px-3 py-1.5 text-sm bg-somnus-danger text-somnus-background"
                disabled={task.busy || deleteName !== view.name}
              >
                {t("drive.members.deleteSubmit")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
