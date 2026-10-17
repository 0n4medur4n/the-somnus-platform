import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import { fromUtf8, utf8 } from "../crypto.js";
import type { DriveFolderView, DriveItem, DriveSession } from "../drive-session.js";
import { DriveMembers } from "./DriveMembers.js";
import { DriveNoteEditor } from "./DriveNote.js";
import {
  formatBytes,
  formatDate,
  isTextual,
  KindIcon,
  Notice,
  PREVIEWABLE_IMAGES,
  saveBytes,
  useDriveTask,
} from "./drive-ui.js";

type Kind = "folder" | "note" | "file";

function kindOf(item: DriveItem): Kind {
  if (item.node.kind === "folder") return "folder";
  return item.meta?.note ? "note" : "file";
}

function byFolderThenName(a: DriveItem, b: DriveItem): number {
  if (a.node.kind !== b.node.kind) return a.node.kind === "folder" ? -1 : 1;
  return (a.meta?.name ?? "").localeCompare(b.meta?.name ?? "");
}

type Panel =
  | { kind: "none" }
  | { kind: "newFolder" }
  | { kind: "newNote" }
  | { kind: "editNote"; item: DriveItem; body: string }
  | { kind: "readNote"; item: DriveItem; body: string }
  | { kind: "preview"; item: DriveItem; text?: string; imageUrl?: string }
  | { kind: "members" }
  | { kind: "trash" };

/**
 * One shared folder, opened. Every name on this screen was decrypted in this
 * browser a moment ago; every action re-encrypts before anything is sent.
 */
export function DriveFolder({
  session,
  view,
  onReload,
  onExit,
}: {
  session: DriveSession;
  view: DriveFolderView;
  onReload: () => Promise<void>;
  onExit: () => void;
}) {
  const { t, i18n } = useTranslation();
  const task = useDriveTask();
  const [currentId, setCurrentId] = useState(view.rootId);
  const [panel, setPanel] = useState<Panel>({ kind: "none" });
  const [progress, setProgress] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; target: string } | null>(null);
  const [folderName, setFolderName] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const canEdit = view.role !== "viewer";
  const isOwner = view.role === "owner";
  const byId = new Map(view.items.map((i) => [i.node.id, i]));

  // A folder that was trashed or deleted elsewhere is not a place to stay in.
  useEffect(() => {
    if (currentId !== view.rootId) {
      const current = byId.get(currentId);
      if (!current || current.node.trashedAt) setCurrentId(view.rootId);
    }
  });

  // Image previews hold a blob URL; release it when the panel changes.
  useEffect(() => {
    if (panel.kind !== "preview" || !panel.imageUrl) return;
    const url = panel.imageUrl;
    return () => URL.revokeObjectURL(url);
  }, [panel]);

  const children = view.items
    .filter((i) => i.node.parentId === currentId && !i.node.trashedAt)
    .sort(byFolderThenName);
  const trashed = view.items.filter((i) => i.node.trashedAt).sort(byFolderThenName);

  const path: Array<{ id: string; name: string }> = [];
  for (let id: string | null = currentId; id && id !== view.rootId; ) {
    const item = byId.get(id);
    if (!item) break;
    path.unshift({ id, name: item.meta?.name ?? "—" });
    id = item.node.parentId;
  }

  async function after(operation: () => Promise<unknown>, success?: string) {
    setNotice(null);
    const ok = await task.run(operation);
    if (ok === null) return false;
    await onReload();
    if (success) setNotice(success);
    return true;
  }

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const done = await after(
        () =>
          session.writeFile(view, {
            parentId: currentId,
            name: file.name,
            mime: file.type || "application/octet-stream",
            bytes,
            onProgress: (n, total) =>
              setProgress(t("drive.folder.uploading", { name: file.name, done: n, total })),
          }),
        t("drive.folder.uploaded", { name: file.name }),
      );
      setProgress(null);
      if (!done) break;
    }
  }

  async function open(item: DriveItem) {
    const kind = kindOf(item);
    if (kind === "folder") {
      setCurrentId(item.node.id);
      setPanel({ kind: "none" });
      return;
    }
    const bytes = await task.run(() => session.readFile(view, item));
    if (!bytes) return;
    const mime = item.meta?.mime;
    if (kind === "note" || isTextual(mime)) {
      const body = fromUtf8(bytes);
      setPanel(
        kind === "note" ? { kind: "readNote", item, body } : { kind: "preview", item, text: body },
      );
    } else if (mime && PREVIEWABLE_IMAGES.has(mime)) {
      const imageUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setPanel({ kind: "preview", item, imageUrl });
    } else {
      setPanel({ kind: "preview", item });
    }
  }

  async function download(item: DriveItem) {
    const bytes = await task.run(() => session.readFile(view, item));
    if (bytes) saveBytes(bytes, item.meta?.name ?? t("drive.folder.kind.file"));
  }

  async function saveNote(title: string, body: string, existing?: DriveItem) {
    const done = await after(
      () =>
        session.writeFile(view, {
          parentId: existing?.node.parentId ?? currentId,
          ...(existing ? { existing } : {}),
          name: title,
          mime: "text/plain",
          bytes: utf8(body),
          note: true,
        }),
      t("drive.note.saved"),
    );
    if (done) setPanel({ kind: "none" });
  }

  function moveTargets(item: DriveItem): Array<{ id: string; name: string }> {
    const excluded = new Set<string>([item.node.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const i of view.items) {
        if (i.node.parentId && excluded.has(i.node.parentId) && !excluded.has(i.node.id)) {
          excluded.add(i.node.id);
          grew = true;
        }
      }
    }
    return [
      { id: view.rootId, name: view.name },
      ...view.items
        .filter((i) => i.node.kind === "folder" && !i.node.trashedAt && !excluded.has(i.node.id))
        .map((i) => ({ id: i.node.id, name: i.meta?.name ?? "—" })),
    ].filter((target) => target.id !== item.node.parentId);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (canEdit && event.dataTransfer.files.length > 0) void upload(event.dataTransfer.files);
  }

  function submitFolder(event: FormEvent) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    void after(() => session.createFolder(view, currentId, name)).then((ok) => {
      if (ok) {
        setFolderName("");
        setPanel({ kind: "none" });
      }
    });
  }

  const toggle = (kind: Panel["kind"]) =>
    setPanel((p) => (p.kind === kind ? { kind: "none" } : ({ kind } as Panel)));

  return (
    <section aria-labelledby="drive-folder-heading" className="flex flex-col gap-4">
      <nav aria-label={t("drive.folder.breadcrumb")}>
        <ol className="flex flex-wrap items-center gap-1 text-sm">
          <li>
            <button type="button" className="text-somnus-primary underline" onClick={onExit}>
              {t("drive.folder.root")}
            </button>
          </li>
          <li aria-hidden="true" className="text-somnus-subtle">
            /
          </li>
          <li>
            <button
              type="button"
              className="text-somnus-primary underline"
              aria-current={currentId === view.rootId ? "page" : undefined}
              onClick={() => setCurrentId(view.rootId)}
            >
              {view.name}
            </button>
          </li>
          {path.map((segment) => (
            <li key={segment.id} className="flex items-center gap-1">
              <span aria-hidden="true" className="text-somnus-subtle">
                /
              </span>
              <button
                type="button"
                className="text-somnus-primary underline"
                aria-current={segment.id === currentId ? "page" : undefined}
                onClick={() => setCurrentId(segment.id)}
              >
                {segment.name}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="drive-folder-heading" className="text-xl font-semibold text-somnus-text">
          {path.at(-1)?.name ?? view.name}
        </h2>
        <span className="rounded-full border border-somnus-subtle/25 px-2.5 py-0.5 text-xs text-somnus-subtle">
          {t(`drive.role.${view.role}`)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <>
            <Button onClick={() => fileInput.current?.click()} disabled={task.busy}>
              {t("drive.folder.upload")}
            </Button>
            <Button variant="secondary" onClick={() => toggle("newNote")} disabled={task.busy}>
              {t("drive.folder.newNote")}
            </Button>
            <Button variant="secondary" onClick={() => toggle("newFolder")} disabled={task.busy}>
              {t("drive.folder.newFolder")}
            </Button>
          </>
        ) : null}
        <Button variant="secondary" onClick={() => toggle("members")}>
          {t("drive.folder.share")}
        </Button>
        <Button variant="secondary" onClick={() => toggle("trash")}>
          {trashed.length > 0
            ? t("drive.folder.trashCount", { count: trashed.length })
            : t("drive.folder.trash")}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {progress ? <Notice tone="info">{progress}</Notice> : null}
      {notice && !task.error ? <Notice tone="success">{notice}</Notice> : null}
      {task.error ? <Notice tone="danger">{task.error}</Notice> : null}

      {panel.kind === "newFolder" ? (
        <form
          onSubmit={submitFolder}
          className="flex flex-col gap-2 rounded-lg border border-somnus-subtle/20 p-4"
        >
          <Field
            label={t("drive.folder.newFolderName")}
            value={folderName}
            maxLength={200}
            autoFocus
            onChange={(e) => setFolderName(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={task.busy || !folderName.trim()}>
              {t("drive.folder.newFolder")}
            </Button>
            <Button variant="secondary" onClick={() => setPanel({ kind: "none" })}>
              {t("drive.cancel")}
            </Button>
          </div>
        </form>
      ) : null}

      {panel.kind === "newNote" ? (
        <DriveNoteEditor
          initialTitle=""
          initialBody=""
          busy={task.busy}
          error={null}
          onSave={(title, body) => void saveNote(title, body)}
          onCancel={() => setPanel({ kind: "none" })}
        />
      ) : null}

      {panel.kind === "editNote" ? (
        <DriveNoteEditor
          initialTitle={panel.item.meta?.name ?? ""}
          initialBody={panel.body}
          busy={task.busy}
          error={null}
          onSave={(title, body) => void saveNote(title, body, panel.item)}
          onCancel={() => setPanel({ kind: "none" })}
        />
      ) : null}

      {panel.kind === "readNote" ? (
        <article className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/20 bg-somnus-surface p-4">
          <h3 className="text-lg font-medium text-somnus-text">{panel.item.meta?.name}</h3>
          <div className="whitespace-pre-wrap break-words text-somnus-text">{panel.body}</div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button
                onClick={() => setPanel({ kind: "editNote", item: panel.item, body: panel.body })}
              >
                {t("drive.note.edit")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setPanel({ kind: "none" })}>
              {t("drive.close")}
            </Button>
          </div>
        </article>
      ) : null}

      {panel.kind === "preview" ? (
        <article className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/20 bg-somnus-surface p-4">
          <h3 className="text-lg font-medium text-somnus-text">{panel.item.meta?.name}</h3>
          {panel.text !== undefined ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-somnus-background p-3 text-sm text-somnus-text">
              {panel.text}
            </pre>
          ) : panel.imageUrl ? (
            <img
              src={panel.imageUrl}
              alt={panel.item.meta?.name ?? ""}
              className="max-h-[60vh] self-start rounded-md"
            />
          ) : (
            <p className="text-somnus-subtle">{t("drive.preview.noPreview")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void download(panel.item)}>{t("drive.folder.download")}</Button>
            <Button variant="secondary" onClick={() => setPanel({ kind: "none" })}>
              {t("drive.close")}
            </Button>
          </div>
        </article>
      ) : null}

      {panel.kind === "members" ? (
        <DriveMembers
          session={session}
          view={view}
          onChanged={() => void onReload()}
          onLeft={onExit}
        />
      ) : null}

      {panel.kind === "trash" ? (
        <section
          aria-labelledby="drive-trash-heading"
          className="flex flex-col gap-3 rounded-lg border border-somnus-subtle/20 p-4"
        >
          <h3 id="drive-trash-heading" className="text-lg font-medium text-somnus-text">
            {t("drive.trash.heading")}
          </h3>
          {trashed.length === 0 ? (
            <p className="text-somnus-subtle">{t("drive.trash.empty")}</p>
          ) : null}
          {!isOwner && trashed.length > 0 ? (
            <p className="text-sm text-somnus-subtle">{t("drive.trash.ownersOnly")}</p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {trashed.map((item) => (
              <li
                key={item.node.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-somnus-subtle/15 p-2"
              >
                <KindIcon kind={kindOf(item)} />
                <span className="text-somnus-text">
                  {item.meta?.name ?? t("drive.folder.unreadable")}
                </span>
                <span className="ml-auto flex gap-2">
                  {canEdit ? (
                    <Button
                      variant="secondary"
                      disabled={task.busy}
                      onClick={() => void after(() => session.restore(view, item))}
                    >
                      {t("drive.trash.restore")}
                    </Button>
                  ) : null}
                  {isOwner ? (
                    <Button
                      variant="secondary"
                      disabled={task.busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            t("drive.trash.purgeConfirm", { name: item.meta?.name ?? "" }),
                          )
                        ) {
                          void after(() => session.purge(view, item));
                        }
                      }}
                    >
                      {t("drive.trash.purge")}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        aria-label={t("drive.folder.items")}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col rounded-lg border ${dragging ? "border-somnus-primary bg-somnus-primary/10" : "border-somnus-subtle/15"}`}
      >
        {children.length === 0 ? (
          <p className="p-6 text-center text-somnus-subtle">
            {t("drive.folder.empty")} {canEdit ? t("drive.folder.dropHint") : ""}
          </p>
        ) : (
          <ul className="divide-y divide-somnus-subtle/10">
            {children.map((item) => {
              const kind = kindOf(item);
              const name = item.meta?.name;
              return (
                <li key={item.node.id} className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <KindIcon kind={kind} />
                    {name ? (
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left font-medium text-somnus-text hover:underline"
                        onClick={() => void open(item)}
                        aria-label={`${t(`drive.folder.kind.${kind}`)}: ${name}`}
                      >
                        {name}
                      </button>
                    ) : (
                      <span className="flex-1 text-somnus-danger">
                        {t("drive.folder.unreadable")}
                        {item.problem ? ` — ${t(`drive.problem.${item.problem}`)}` : ""}
                      </span>
                    )}
                    <span
                      className={`text-xs ${item.signature === "valid" ? "text-somnus-success" : "text-somnus-danger"}`}
                      title={t(
                        item.signature === "valid"
                          ? "drive.folder.verified"
                          : "drive.folder.unverified",
                      )}
                    >
                      {item.signature === "valid" ? "✓ " : "⚠ "}
                      {t(
                        item.signature === "valid"
                          ? "drive.folder.verified"
                          : "drive.folder.unverified",
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-8 text-xs text-somnus-subtle">
                    {kind !== "folder" && item.meta?.size !== undefined ? (
                      <span>{formatBytes(item.meta.size, i18n.language)}</span>
                    ) : null}
                    {item.meta ? (
                      <span>{formatDate(item.meta.modifiedAt, i18n.language)}</span>
                    ) : null}
                    <span>
                      {t("drive.folder.by", {
                        who:
                          item.author.userId === session.me.userId
                            ? t("drive.members.you")
                            : (item.author.email ?? t("drive.folder.unknownAuthor")),
                      })}
                    </span>
                  </div>
                  {item.meta ? (
                    <div className="flex flex-wrap gap-2 pl-8">
                      {kind !== "folder" ? (
                        <Button
                          variant="secondary"
                          className="px-3 py-1 text-sm"
                          disabled={task.busy}
                          onClick={() => void download(item)}
                        >
                          {t("drive.folder.download")}
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <>
                          <Button
                            variant="secondary"
                            className="px-3 py-1 text-sm"
                            onClick={() => setRenaming({ id: item.node.id, value: name ?? "" })}
                          >
                            {t("drive.folder.rename")}
                          </Button>
                          <Button
                            variant="secondary"
                            className="px-3 py-1 text-sm"
                            onClick={() => setMoving({ id: item.node.id, target: "" })}
                          >
                            {t("drive.folder.move")}
                          </Button>
                          <Button
                            variant="secondary"
                            className="px-3 py-1 text-sm"
                            disabled={task.busy}
                            onClick={() => void after(() => session.trash(view, item))}
                          >
                            {t("drive.folder.toTrash")}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {renaming?.id === item.node.id ? (
                    <form
                      className="flex flex-wrap items-end gap-2 pl-8"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const value = renaming.value.trim();
                        if (!value) return;
                        void after(() => session.rename(view, item, value)).then((ok) => {
                          if (ok) setRenaming(null);
                        });
                      }}
                    >
                      <Field
                        label={t("drive.folder.renameTo")}
                        value={renaming.value}
                        maxLength={200}
                        autoFocus
                        onChange={(e) => setRenaming({ id: item.node.id, value: e.target.value })}
                      />
                      <Button type="submit" disabled={task.busy}>
                        {t("drive.save")}
                      </Button>
                      <Button variant="secondary" onClick={() => setRenaming(null)}>
                        {t("drive.cancel")}
                      </Button>
                    </form>
                  ) : null}
                  {moving?.id === item.node.id ? (
                    <form
                      className="flex flex-wrap items-end gap-2 pl-8"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!moving.target) return;
                        void after(() => session.move(view, item, moving.target)).then((ok) => {
                          if (ok) setMoving(null);
                        });
                      }}
                    >
                      <label className="flex flex-col gap-1 text-sm text-somnus-text">
                        {t("drive.folder.moveTo")}
                        <select
                          value={moving.target}
                          onChange={(e) => setMoving({ id: item.node.id, target: e.target.value })}
                          className="rounded-md border border-somnus-muted/40 bg-somnus-background px-3 py-2 text-somnus-text"
                        >
                          <option value="">—</option>
                          {moveTargets(item).map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button type="submit" disabled={task.busy || !moving.target}>
                        {t("drive.folder.move")}
                      </Button>
                      <Button variant="secondary" onClick={() => setMoving(null)}>
                        {t("drive.cancel")}
                      </Button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
