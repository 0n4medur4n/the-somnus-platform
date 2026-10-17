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
}: {
  session: DriveSession;
  view: DriveFolderView;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const { t } = useTranslation();
  const task = useDriveTask();
  const isOwner = view.role === "owner";
  const memberIds = new Set(view.members.map((m) => m.userId));
  const candidates = session.colleagues().filter((c) => !memberIds.has(c.userId));
  const [chosen, setChosen] = useState("");
  const [role, setRole] = useState<DriveRole>("viewer");
  const [newName, setNewName] = useState(view.name);
  const [deleteName, setDeleteName] = useState("");
  const candidate = candidates.find((c) => c.userId === chosen);

  async function share(event: FormEvent) {
    event.preventDefault();
    if (!candidate) return;
    const ok = await task.run(() => session.addMember(view, candidate.userId, role));
    if (ok !== null) {
      setChosen("");
      onChanged();
    }
  }

  async function act(operation: () => Promise<unknown>) {
    const ok = await task.run(operation);
    if (ok !== null) onChanged();
  }

  return (
    <section
      aria-labelledby="drive-members-heading"
      className="flex flex-col gap-4 rounded-lg border border-somnus-subtle/20 bg-somnus-surface p-4"
    >
      <h3 id="drive-members-heading" className="text-lg font-medium text-somnus-text">
        {t("drive.members.heading")}
      </h3>
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
                <TrustBadge trust={member.trust} />
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
                          variant="secondary"
                          disabled={task.busy}
                          onClick={() => void act(() => session.markVerified(member.userId))}
                        >
                          {t("drive.members.markVerified")}
                        </Button>
                      ) : null}
                      {member.trust === "changed" ? (
                        <Button
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
                  onChange={(e) => setChosen(e.target.value)}
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
                <div className="flex flex-col gap-2 text-sm text-somnus-subtle">
                  <p>{t("drive.members.checkFingerprint", { who: candidate.email })}</p>
                  <Fingerprint value={candidate.fingerprint} />
                  <TrustBadge trust={candidate.trust} />
                  {candidate.trust === "changed" ? (
                    <Notice tone="danger">{t("drive.trustHelp.changed")}</Notice>
                  ) : null}
                </div>
              ) : null}
              <Button
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
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) void act(() => session.renameShare(view, newName.trim()));
            }}
          >
            <Field
              label={t("drive.members.renameFolder")}
              value={newName}
              maxLength={200}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div>
              <Button type="submit" variant="secondary" disabled={task.busy || !newName.trim()}>
                {t("drive.save")}
              </Button>
            </div>
          </form>
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
                className="bg-somnus-danger text-somnus-background"
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
