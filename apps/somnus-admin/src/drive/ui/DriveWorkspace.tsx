import type { DriveAccount } from "@somnus/api-contracts";
import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.js";
import { Field } from "../../components/Field.js";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import {
  Badge,
  EmptyState,
  IconButton,
  Menu,
  type MenuItem,
  Modal,
} from "../../components/ui/ui.js";
import { fromUtf8, utf8 } from "../crypto.js";
import type {
  DriveFolderView,
  DriveItem,
  DriveSession,
  DriveShareEntry,
} from "../drive-session.js";
import { ChangePassphrase, OwnFingerprint } from "./DriveAccess.js";
import { DriveGuideContent } from "./DriveGuide.js";
import { DriveMembers } from "./DriveMembers.js";
import { DriveNoteEditor } from "./DriveNote.js";
import {
  formatBytes,
  formatDate,
  isTextual,
  Notice,
  PREVIEWABLE_IMAGES,
  saveBytes,
  TrustBadge,
  useDriveTask,
} from "./drive-ui.js";

type Kind = "folder" | "note" | "image" | "file";

function kindOf(item: DriveItem): Kind {
  if (item.node.kind === "folder") return "folder";
  if (item.meta?.note) return "note";
  if (item.meta?.mime && PREVIEWABLE_IMAGES.has(item.meta.mime)) return "image";
  return "file";
}

const KIND_ICON: Record<Kind, IconName> = {
  folder: "folder",
  note: "note",
  image: "image",
  file: "file",
};

function byFolderThenName(a: DriveItem, b: DriveItem): number {
  if (a.node.kind !== b.node.kind) return a.node.kind === "folder" ? -1 : 1;
  return (a.meta?.name ?? "").localeCompare(b.meta?.name ?? "");
}

type Dialog =
  | { kind: "none" }
  | { kind: "newShare" }
  | { kind: "newFolder" }
  | { kind: "newNote" }
  | { kind: "editNote"; item: DriveItem; body: string }
  | { kind: "readNote"; item: DriveItem; body: string }
  | { kind: "preview"; item: DriveItem; text?: string; imageUrl?: string }
  | { kind: "rename"; item: DriveItem }
  | { kind: "renameShare" }
  | { kind: "move"; item: DriveItem }
  | { kind: "purge"; item: DriveItem }
  | { kind: "guide" }
  | { kind: "security" };

type Side = { kind: "none" } | { kind: "people" } | { kind: "details"; item: DriveItem };

type Upload = { id: string; name: string; done: number; total: number; error?: string };

/**
 * The open Drive, laid out like a drive: folders on the left, the current
 * folder's contents in the middle (list or grid), people and details on the
 * right. Every name on screen was decrypted in this browser a moment ago, and
 * every action re-encrypts before anything is sent -- the layout changed, the
 * cryptography in DriveSession did not.
 */
export function DriveWorkspace({
  session,
  account,
  onAccountChanged,
  onLock,
}: {
  session: DriveSession;
  account: DriveAccount;
  onAccountChanged: (account: DriveAccount) => void;
  onLock: () => void;
}) {
  const { t, i18n } = useTranslation();
  const task = useDriveTask();
  const { run } = task;
  const [shares, setShares] = useState<DriveShareEntry[] | null>(null);
  const [view, setView] = useState<DriveFolderView | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const [side, setSide] = useState<Side>({ kind: "none" });
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshShares = useCallback(async () => {
    const list = await run(() => session.listShares());
    if (list) setShares(list);
  }, [session, run]);

  useEffect(() => {
    void refreshShares();
  }, [refreshShares]);

  // A preview holds a blob URL; release it when the dialog changes.
  useEffect(() => {
    if (dialog.kind !== "preview" || !dialog.imageUrl) return;
    const url = dialog.imageUrl;
    return () => URL.revokeObjectURL(url);
  }, [dialog]);

  async function openShare(shareId: string) {
    const opened = await run(() => session.openShare(shareId));
    if (!opened) return;
    setView(opened);
    setFolderId(opened.rootId);
    setTrash(false);
    setQuery("");
    setSide({ kind: "none" });
  }

  async function reload() {
    if (!view) return;
    const opened = await run(() => session.openShare(view.shareId));
    if (!opened) {
      // The folder was deleted, or I was removed from it.
      setView(null);
      void refreshShares();
      return;
    }
    setView(opened);
    // Details shown for an item that changed must show the new version.
    setSide((s) =>
      s.kind === "details"
        ? (() => {
            const fresh = opened.items.find((i) => i.node.id === s.item.node.id);
            return fresh ? { kind: "details", item: fresh } : { kind: "none" };
          })()
        : s,
    );
  }

  function goHome() {
    setView(null);
    setTrash(false);
    setQuery("");
    setSide({ kind: "none" });
    void refreshShares();
  }

  async function act(operation: () => Promise<unknown>, success?: string): Promise<boolean> {
    setNotice(null);
    const ok = await run(operation);
    if (ok === null) return false;
    await reload();
    if (success) setNotice(success);
    return true;
  }

  const canEdit = view !== null && view.role !== "viewer";
  const isOwner = view?.role === "owner";
  const byId = new Map(view?.items.map((i) => [i.node.id, i]) ?? []);
  const current = folderId ?? view?.rootId ?? null;

  // A folder that was trashed or deleted elsewhere is not a place to stay in.
  useEffect(() => {
    if (!view || !current || current === view.rootId) return;
    const here = view.items.find((i) => i.node.id === current);
    if (!here || here.node.trashedAt) setFolderId(view.rootId);
  }, [view, current]);

  const path: Array<{ id: string; name: string }> = [];
  if (view) {
    for (let id: string | null = current; id && id !== view.rootId; ) {
      const item = byId.get(id);
      if (!item) break;
      path.unshift({ id, name: item.meta?.name ?? "—" });
      id = item.node.parentId;
    }
  }

  const needle = query.trim().toLocaleLowerCase(i18n.language);
  const visible: DriveItem[] = !view
    ? []
    : trash
      ? view.items.filter((i) => i.node.trashedAt)
      : needle
        ? view.items.filter(
            (i) =>
              !i.node.trashedAt &&
              (i.meta?.name ?? "").toLocaleLowerCase(i18n.language).includes(needle),
          )
        : view.items.filter((i) => i.node.parentId === current && !i.node.trashedAt);
  visible.sort(byFolderThenName);
  const trashedCount = view?.items.filter((i) => i.node.trashedAt).length ?? 0;

  async function upload(files: FileList | File[]) {
    if (!view || !current) return;
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: file.name, done: 0, total: 1 }]);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ok = await run(() =>
        session.writeFile(view, {
          parentId: current,
          name: file.name,
          mime: file.type || "application/octet-stream",
          bytes,
          onProgress: (done, total) =>
            setUploads((u) => u.map((x) => (x.id === id ? { ...x, done, total } : x))),
        }),
      );
      if (ok === null) {
        setUploads((u) =>
          u.map((x) => (x.id === id ? { ...x, error: t("drive.uploadFailed") } : x)),
        );
        break;
      }
      setTimeout(() => setUploads((u) => u.filter((x) => x.id !== id)), 2500);
    }
    await reload();
  }

  async function open(item: DriveItem) {
    if (!view) return;
    const kind = kindOf(item);
    if (kind === "folder") {
      setFolderId(item.node.id);
      setQuery("");
      return;
    }
    const bytes = await run(() => session.readFile(view, item));
    if (!bytes) return;
    if (kind === "note") {
      setDialog({ kind: "readNote", item, body: fromUtf8(bytes) });
    } else if (isTextual(item.meta?.mime)) {
      setDialog({ kind: "preview", item, text: fromUtf8(bytes) });
    } else if (kind === "image" && item.meta?.mime) {
      setDialog({
        kind: "preview",
        item,
        imageUrl: URL.createObjectURL(new Blob([bytes], { type: item.meta.mime })),
      });
    } else {
      setDialog({ kind: "preview", item });
    }
  }

  async function download(item: DriveItem) {
    if (!view) return;
    const bytes = await run(() => session.readFile(view, item));
    if (bytes) saveBytes(bytes, item.meta?.name ?? t("drive.folder.kind.file"));
  }

  async function saveNote(title: string, body: string, existing?: DriveItem) {
    if (!view || !current) return;
    const ok = await act(
      () =>
        session.writeFile(view, {
          parentId: existing?.node.parentId ?? current,
          ...(existing ? { existing } : {}),
          name: title,
          mime: "text/plain",
          bytes: utf8(body),
          note: true,
        }),
      t("drive.note.saved"),
    );
    if (ok) setDialog({ kind: "none" });
  }

  function itemMenu(item: DriveItem): MenuItem[] {
    const kind = kindOf(item);
    if (trash) {
      return [
        ...(canEdit
          ? [
              {
                label: t("drive.trash.restore"),
                icon: "restore" as const,
                onSelect: () => void act(() => session.restore(view as DriveFolderView, item)),
              },
            ]
          : []),
        ...(isOwner
          ? [
              {
                label: t("drive.trash.purge"),
                icon: "trash" as const,
                danger: true,
                onSelect: () => setDialog({ kind: "purge", item }),
              },
            ]
          : []),
      ];
    }
    return [
      { label: t("drive.folder.open"), icon: "chevronRight", onSelect: () => void open(item) },
      ...(kind !== "folder"
        ? [
            {
              label: t("drive.folder.download"),
              icon: "download" as const,
              onSelect: () => void download(item),
            },
          ]
        : []),
      ...(canEdit
        ? [
            {
              label: t("drive.folder.rename"),
              icon: "pencil" as const,
              onSelect: () => setDialog({ kind: "rename", item }),
            },
            {
              label: t("drive.folder.move"),
              icon: "move" as const,
              onSelect: () => setDialog({ kind: "move", item }),
            },
          ]
        : []),
      {
        label: t("drive.details"),
        icon: "info",
        onSelect: () => setSide({ kind: "details", item }),
      },
      ...(canEdit
        ? [
            {
              label: t("drive.folder.toTrash"),
              icon: "trash" as const,
              danger: true,
              onSelect: () => void act(() => session.trash(view as DriveFolderView, item)),
            },
          ]
        : []),
    ];
  }

  const newItems: MenuItem[] = [
    {
      label: t("drive.shares.new"),
      icon: "folderShared",
      onSelect: () => setDialog({ kind: "newShare" }),
    },
    ...(view && canEdit && !trash
      ? [
          {
            label: t("drive.folder.newFolder"),
            icon: "folderPlus" as const,
            onSelect: () => setDialog({ kind: "newFolder" }),
          },
          {
            label: t("drive.folder.newNote"),
            icon: "note" as const,
            onSelect: () => setDialog({ kind: "newNote" }),
          },
          {
            label: t("drive.folder.upload"),
            icon: "upload" as const,
            onSelect: () => fileInput.current?.click(),
          },
        ]
      : []),
  ];

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (canEdit && !trash && event.dataTransfer.files.length > 0) {
      void upload(event.dataTransfer.files);
    }
  }

  const authorOf = (item: DriveItem) =>
    item.author.userId === session.me.userId
      ? t("drive.members.you")
      : (item.author.email ?? t("drive.folder.unknownAuthor"));

  return (
    <div className="flex flex-col gap-3">
      <div className="grid min-h-[70vh] overflow-hidden rounded-xl border border-white/[0.06] bg-somnus-surface/60 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* --- left: new, folders, security --- */}
        <aside className="flex flex-col gap-4 border-b border-white/[0.06] p-3 lg:border-b-0 lg:border-r">
          <Menu
            label={t("drive.new")}
            align="left"
            items={newItems}
            trigger={({ onClick, expanded }) => (
              <button
                type="button"
                onClick={onClick}
                aria-haspopup="menu"
                aria-expanded={expanded}
                className="flex w-full items-center gap-2 rounded-xl bg-somnus-primary-strong px-4 py-3 font-medium text-white shadow-lg shadow-somnus-primary/20 hover:brightness-110"
              >
                <Icon name="plus" />
                {t("drive.new")}
              </button>
            )}
          />
          <nav aria-label={t("drive.sharedFolders")} className="flex flex-col gap-0.5">
            <SideLink
              icon="drive"
              label={t("drive.home")}
              current={view === null}
              onClick={goHome}
            />
            <p className="mt-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-somnus-muted">
              {t("drive.sharedFolders")}
            </p>
            {shares === null ? (
              <p className="px-3 text-sm text-somnus-subtle">{t("drive.loading")}</p>
            ) : shares.length === 0 ? (
              <p className="px-3 text-sm text-somnus-subtle">{t("drive.noFoldersYet")}</p>
            ) : (
              shares.map((s) => (
                <SideLink
                  key={s.shareId}
                  icon="folderShared"
                  label={s.name ?? t("drive.shares.unreadable")}
                  current={view?.shareId === s.shareId && !trash}
                  disabled={s.name === null}
                  onClick={() => void openShare(s.shareId)}
                />
              ))
            )}
            {view ? (
              <SideLink
                icon="trash"
                label={t("drive.folder.trash")}
                current={trash}
                count={trashedCount}
                onClick={() => {
                  setTrash(true);
                  setQuery("");
                }}
              />
            ) : null}
          </nav>
          <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.06] pt-3">
            <SideLink
              icon="fingerprint"
              label={t("drive.security")}
              onClick={() => setDialog({ kind: "security" })}
            />
            <SideLink
              icon="help"
              label={t("drive.guide")}
              onClick={() => setDialog({ kind: "guide" })}
            />
            <SideLink icon="lock" label={t("drive.lock")} onClick={onLock} />
          </div>
        </aside>

        {/* --- middle: toolbar + contents --- */}
        <section
          aria-label={t("drive.folder.items")}
          className="relative flex min-w-0 flex-col"
          onDragOver={(e) => {
            if (!canEdit || trash) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3">
            <nav aria-label={t("drive.folder.breadcrumb")} className="min-w-0 flex-1">
              <ol className="flex flex-wrap items-center gap-1 text-sm">
                <li>
                  <button
                    type="button"
                    onClick={goHome}
                    className="rounded px-1.5 py-0.5 text-somnus-subtle hover:bg-white/5 hover:text-somnus-text"
                  >
                    {t("drive.home")}
                  </button>
                </li>
                {view ? (
                  <>
                    <Crumb />
                    <li>
                      <button
                        type="button"
                        aria-current={current === view.rootId && !trash ? "page" : undefined}
                        onClick={() => {
                          setFolderId(view.rootId);
                          setTrash(false);
                          setQuery("");
                        }}
                        className="rounded px-1.5 py-0.5 font-medium text-somnus-text hover:bg-white/5"
                      >
                        {view.name}
                      </button>
                    </li>
                    {trash ? (
                      <>
                        <Crumb />
                        <li className="px-1.5 font-medium text-somnus-text">
                          {t("drive.folder.trash")}
                        </li>
                      </>
                    ) : (
                      path.map((segment) => (
                        <li key={segment.id} className="flex items-center gap-1">
                          <Crumb />
                          <button
                            type="button"
                            aria-current={segment.id === current ? "page" : undefined}
                            onClick={() => setFolderId(segment.id)}
                            className="rounded px-1.5 py-0.5 font-medium text-somnus-text hover:bg-white/5"
                          >
                            {segment.name}
                          </button>
                        </li>
                      ))
                    )}
                  </>
                ) : null}
              </ol>
            </nav>
            {view && !trash ? (
              <label className="relative flex items-center">
                <span className="sr-only">{t("drive.search")}</span>
                <Icon
                  name="search"
                  className="pointer-events-none absolute left-2.5 h-4 w-4 text-somnus-subtle"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("drive.searchPlaceholder")}
                  className="w-44 rounded-lg border border-white/10 bg-somnus-background/60 py-1.5 pl-8 pr-2 text-sm text-somnus-text placeholder:text-somnus-subtle focus:w-60 focus:border-somnus-primary"
                />
              </label>
            ) : null}
            <div className="flex items-center gap-1">
              <IconButton
                icon="list"
                label={t("drive.viewList")}
                active={layout === "list"}
                onClick={() => setLayout("list")}
              />
              <IconButton
                icon="grid"
                label={t("drive.viewGrid")}
                active={layout === "grid"}
                onClick={() => setLayout("grid")}
              />
              {view ? (
                <button
                  type="button"
                  onClick={() =>
                    setSide((s) => (s.kind === "people" ? { kind: "none" } : { kind: "people" }))
                  }
                  aria-pressed={side.kind === "people"}
                  className="ml-1 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
                >
                  <Icon name="share" className="h-4 w-4" />
                  {t("drive.folder.share")}
                  <span className="tabular-nums text-somnus-subtle">{view.members.length}</span>
                </button>
              ) : null}
            </div>
          </div>

          {task.error ? (
            <div className="px-4 pt-3">
              <Notice tone="danger">{task.error}</Notice>
            </div>
          ) : null}
          {notice && !task.error ? (
            <div className="px-4 pt-3">
              <Notice tone="success">{notice}</Notice>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto p-4">
              {!view ? (
                <ShareGrid
                  shares={shares}
                  onOpen={(id) => void openShare(id)}
                  onCreate={() => setDialog({ kind: "newShare" })}
                />
              ) : visible.length === 0 ? (
                trash ? (
                  <EmptyState icon="trash" title={t("drive.trash.empty")} />
                ) : needle ? (
                  <EmptyState icon="search" title={t("drive.noResults")} />
                ) : (
                  <EmptyState icon="upload" title={t("drive.folder.empty")}>
                    {canEdit ? t("drive.folder.dropHint") : null}
                  </EmptyState>
                )
              ) : layout === "list" ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wide text-somnus-subtle">
                      <th className="py-2 pl-2 font-medium">{t("drive.columns.name")}</th>
                      <th
                        className={`hidden py-2 pr-4 font-medium ${side.kind === "none" ? "md:table-cell" : "2xl:table-cell"}`}
                      >
                        {t("drive.columns.author")}
                      </th>
                      <th className="hidden py-2 pr-4 font-medium sm:table-cell">
                        {t("drive.columns.modified")}
                      </th>
                      <th className="hidden py-2 pr-2 text-right font-medium sm:table-cell">
                        {t("drive.columns.size")}
                      </th>
                      <th className="w-10 py-2">
                        <span className="sr-only">{t("drive.columns.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr
                        key={item.node.id}
                        className="group border-b border-white/[0.04] hover:bg-white/[0.03]"
                      >
                        <td className="py-1.5 pl-2 pr-4">
                          <ItemName
                            item={item}
                            kind={kindOf(item)}
                            disabled={trash}
                            onOpen={() => void open(item)}
                            location={
                              needle && item.node.parentId && item.node.parentId !== view.rootId
                                ? (byId.get(item.node.parentId)?.meta?.name ?? null)
                                : null
                            }
                          />
                        </td>
                        <td
                          className={`hidden max-w-48 truncate py-1.5 pr-4 text-somnus-subtle ${side.kind === "none" ? "md:table-cell" : "2xl:table-cell"}`}
                        >
                          {authorOf(item)}
                        </td>
                        <td className="hidden whitespace-nowrap py-1.5 pr-4 text-somnus-subtle sm:table-cell">
                          {item.meta ? formatDate(item.meta.modifiedAt, i18n.language) : "—"}
                        </td>
                        <td className="hidden whitespace-nowrap py-1.5 pr-2 text-right tabular-nums text-somnus-subtle sm:table-cell">
                          {item.node.kind === "file" && item.meta?.size !== undefined
                            ? formatBytes(item.meta.size, i18n.language)
                            : "—"}
                        </td>
                        <td className="py-1.5 text-right">
                          {item.meta ? (
                            <Menu
                              label={t("drive.actionsFor", { name: item.meta.name })}
                              items={itemMenu(item)}
                            />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
                  {visible.map((item) => {
                    const kind = kindOf(item);
                    return (
                      <li
                        key={item.node.id}
                        className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-somnus-background/40 hover:border-somnus-primary/40"
                      >
                        <button
                          type="button"
                          disabled={trash || !item.meta}
                          onClick={() => void open(item)}
                          aria-label={`${t(`drive.folder.kind.${kind === "image" ? "file" : kind}`)}: ${item.meta?.name ?? t("drive.folder.unreadable")}`}
                          className="flex h-24 items-center justify-center bg-white/[0.02] text-somnus-primary"
                        >
                          <Icon name={KIND_ICON[kind]} className="h-10 w-10" />
                        </button>
                        <div className="flex items-center gap-1 p-2">
                          <span className="min-w-0 flex-1 truncate text-sm text-somnus-text">
                            {item.meta?.name ?? t("drive.folder.unreadable")}
                          </span>
                          {item.meta ? (
                            <Menu
                              label={t("drive.actionsFor", { name: item.meta.name })}
                              items={itemMenu(item)}
                            />
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {view && side.kind !== "none" ? (
              <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-white/[0.06] p-4 xl:block">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-somnus-text">
                    {side.kind === "people" ? t("drive.members.heading") : t("drive.details")}
                  </h2>
                  <IconButton
                    icon="x"
                    label={t("ui.close")}
                    onClick={() => setSide({ kind: "none" })}
                  />
                </div>
                {side.kind === "people" ? (
                  <DriveMembers
                    session={session}
                    view={view}
                    onChanged={() => void reload()}
                    onLeft={goHome}
                    onRename={() => setDialog({ kind: "renameShare" })}
                  />
                ) : (
                  <Details item={side.item} authorLabel={authorOf(side.item)} />
                )}
              </aside>
            ) : null}
          </div>

          {dragging ? (
            <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-somnus-primary bg-somnus-primary/10">
              <p className="flex items-center gap-2 font-medium text-somnus-text">
                <Icon name="upload" />
                {t("drive.dropToUpload", { folder: path.at(-1)?.name ?? view?.name ?? "" })}
              </p>
            </div>
          ) : null}
        </section>
      </div>

      {/* The people panel, below xl, opens as a dialog instead of a side panel. */}
      {view && side.kind === "people" ? (
        <div className="xl:hidden">
          <Modal title={t("drive.members.heading")} onClose={() => setSide({ kind: "none" })}>
            <DriveMembers
              session={session}
              view={view}
              onChanged={() => void reload()}
              onLeft={goHome}
              onRename={() => setDialog({ kind: "renameShare" })}
            />
          </Modal>
        </div>
      ) : null}
      {view && side.kind === "details" ? (
        <div className="xl:hidden">
          <Modal title={t("drive.details")} onClose={() => setSide({ kind: "none" })}>
            <Details item={side.item} authorLabel={authorOf(side.item)} />
          </Modal>
        </div>
      ) : null}

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

      {uploads.length > 0 ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-40 w-80 overflow-hidden rounded-xl border border-white/10 bg-[#0f1528] shadow-2xl"
        >
          <p className="border-b border-white/[0.06] px-4 py-2.5 text-sm font-medium text-somnus-text">
            {t("drive.uploads")}
          </p>
          <ul className="max-h-60 overflow-y-auto">
            {uploads.map((u) => (
              <li key={u.id} className="flex flex-col gap-1.5 px-4 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Icon
                    name={u.error ? "alert" : u.done >= u.total ? "check" : "lock"}
                    className={`h-4 w-4 ${u.error ? "text-somnus-danger" : "text-somnus-success"}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-somnus-text">{u.name}</span>
                </div>
                {u.error ? (
                  <span className="text-xs text-somnus-danger">{u.error}</span>
                ) : (
                  <div className="h-1.5 rounded-full bg-white/[0.06]">
                    <div
                      className="h-1.5 rounded-full bg-somnus-primary transition-all"
                      style={{ width: `${Math.round((u.done / u.total) * 100)}%` }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* --- dialogs --- */}
      {dialog.kind === "newShare" ? (
        <NameDialog
          title={t("drive.shares.new")}
          label={t("drive.shares.newName")}
          submit={t("drive.shares.create")}
          busy={task.busy}
          error={task.error}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={async (name) => {
            const ok = await run(() => session.createShare(name));
            if (ok === null) return;
            setDialog({ kind: "none" });
            await refreshShares();
          }}
        />
      ) : null}
      {dialog.kind === "newFolder" && view && current ? (
        <NameDialog
          title={t("drive.folder.newFolder")}
          label={t("drive.folder.newFolderName")}
          submit={t("drive.create")}
          busy={task.busy}
          error={task.error}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={async (name) => {
            if (await act(() => session.createFolder(view, current, name))) {
              setDialog({ kind: "none" });
            }
          }}
        />
      ) : null}
      {dialog.kind === "rename" && view ? (
        <NameDialog
          title={t("drive.folder.rename")}
          label={t("drive.folder.renameTo")}
          initial={dialog.item.meta?.name ?? ""}
          submit={t("drive.save")}
          busy={task.busy}
          error={task.error}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={async (name) => {
            if (await act(() => session.rename(view, dialog.item, name))) {
              setDialog({ kind: "none" });
            }
          }}
        />
      ) : null}
      {dialog.kind === "renameShare" && view ? (
        <NameDialog
          title={t("drive.members.renameFolder")}
          label={t("drive.folder.renameTo")}
          initial={view.name}
          submit={t("drive.save")}
          busy={task.busy}
          error={task.error}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={async (name) => {
            if (await act(() => session.renameShare(view, name))) {
              setDialog({ kind: "none" });
              void refreshShares();
            }
          }}
        />
      ) : null}
      {dialog.kind === "move" && view ? (
        <MoveDialog
          view={view}
          item={dialog.item}
          busy={task.busy}
          error={task.error}
          onClose={() => setDialog({ kind: "none" })}
          onSubmit={async (target) => {
            if (await act(() => session.move(view, dialog.item, target))) {
              setDialog({ kind: "none" });
            }
          }}
        />
      ) : null}
      {dialog.kind === "purge" && view ? (
        <Modal title={t("drive.trash.purge")} onClose={() => setDialog({ kind: "none" })}>
          <p className="text-somnus-text">
            {t("drive.trash.purgeConfirm", { name: dialog.item.meta?.name ?? "" })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog({ kind: "none" })}>
              {t("drive.cancel")}
            </Button>
            <Button
              className="bg-somnus-danger text-somnus-background"
              disabled={task.busy}
              onClick={() =>
                void act(() => session.purge(view, dialog.item)).then(
                  (ok) => ok && setDialog({ kind: "none" }),
                )
              }
            >
              {t("drive.trash.purge")}
            </Button>
          </div>
        </Modal>
      ) : null}
      {dialog.kind === "newNote" ? (
        <Modal title={t("drive.folder.newNote")} onClose={() => setDialog({ kind: "none" })} wide>
          <DriveNoteEditor
            initialTitle=""
            initialBody=""
            busy={task.busy}
            error={task.error}
            onSave={(title, body) => void saveNote(title, body)}
            onCancel={() => setDialog({ kind: "none" })}
          />
        </Modal>
      ) : null}
      {dialog.kind === "editNote" ? (
        <Modal
          title={dialog.item.meta?.name ?? ""}
          onClose={() => setDialog({ kind: "none" })}
          wide
        >
          <DriveNoteEditor
            initialTitle={dialog.item.meta?.name ?? ""}
            initialBody={dialog.body}
            busy={task.busy}
            error={task.error}
            onSave={(title, body) => void saveNote(title, body, dialog.item)}
            onCancel={() => setDialog({ kind: "none" })}
          />
        </Modal>
      ) : null}
      {dialog.kind === "readNote" ? (
        <Modal
          title={dialog.item.meta?.name ?? ""}
          onClose={() => setDialog({ kind: "none" })}
          wide
        >
          <article className="whitespace-pre-wrap break-words leading-relaxed text-somnus-text">
            {dialog.body}
          </article>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => void download(dialog.item)}>
              {t("drive.folder.download")}
            </Button>
            {canEdit ? (
              <Button
                onClick={() =>
                  setDialog({ kind: "editNote", item: dialog.item, body: dialog.body })
                }
              >
                {t("drive.note.edit")}
              </Button>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {dialog.kind === "preview" ? (
        <Modal
          title={dialog.item.meta?.name ?? ""}
          onClose={() => setDialog({ kind: "none" })}
          wide
        >
          {dialog.text !== undefined ? (
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-somnus-background p-4 text-sm text-somnus-text">
              {dialog.text}
            </pre>
          ) : dialog.imageUrl ? (
            <img
              src={dialog.imageUrl}
              alt={dialog.item.meta?.name ?? ""}
              className="mx-auto max-h-[60vh] rounded-lg"
            />
          ) : (
            <EmptyState icon="file" title={t("drive.preview.noPreview")} />
          )}
          <div className="mt-5 flex justify-end">
            <Button onClick={() => void download(dialog.item)}>
              <Icon name="download" className="mr-2 h-4 w-4" />
              {t("drive.folder.download")}
            </Button>
          </div>
        </Modal>
      ) : null}
      {dialog.kind === "guide" ? (
        <Modal
          title={t("drive.guideContent.heading")}
          onClose={() => setDialog({ kind: "none" })}
          wide
        >
          <DriveGuideContent />
        </Modal>
      ) : null}
      {dialog.kind === "security" ? (
        <Modal title={t("drive.security")} onClose={() => setDialog({ kind: "none" })}>
          <div className="flex flex-col gap-5">
            <OwnFingerprint fingerprint={session.me.fingerprint} />
            <ChangePassphrase
              account={account}
              onChanged={onAccountChanged}
              onCancel={() => setDialog({ kind: "none" })}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Crumb() {
  return (
    <li aria-hidden="true" className="text-somnus-muted">
      <Icon name="chevronRight" className="h-4 w-4" />
    </li>
  );
}

function SideLink({
  icon,
  label,
  current,
  count,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  current?: boolean;
  count?: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={current ? "page" : undefined}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
        current
          ? "bg-somnus-primary/15 text-somnus-text"
          : "text-somnus-subtle hover:bg-white/[0.04] hover:text-somnus-text"
      }`}
    >
      <Icon
        name={icon}
        className={`h-[18px] w-[18px] shrink-0 ${current ? "text-somnus-primary" : ""}`}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-xs tabular-nums text-somnus-subtle">{count}</span> : null}
    </button>
  );
}

function ItemName({
  item,
  kind,
  disabled,
  location,
  onOpen,
}: {
  item: DriveItem;
  kind: Kind;
  disabled?: boolean;
  location: string | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const name = item.meta?.name;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Icon
        name={KIND_ICON[kind]}
        className={`h-5 w-5 shrink-0 ${kind === "folder" ? "text-somnus-primary" : "text-somnus-subtle"}`}
      />
      <div className="min-w-0">
        {name ? (
          <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            aria-label={`${t(`drive.folder.kind.${kind === "image" ? "file" : kind}`)}: ${name}`}
            className="block max-w-full truncate text-left font-medium text-somnus-text hover:underline disabled:no-underline"
          >
            {name}
          </button>
        ) : (
          <span className="text-somnus-danger">
            {t("drive.folder.unreadable")}
            {item.problem ? ` — ${t(`drive.problem.${item.problem}`)}` : ""}
          </span>
        )}
        <span className="flex items-center gap-2 text-xs text-somnus-subtle">
          <span
            className={`inline-flex items-center gap-1 ${item.signature === "valid" ? "text-somnus-success" : "text-somnus-danger"}`}
          >
            <Icon name={item.signature === "valid" ? "check" : "alert"} className="h-3 w-3" />
            {t(item.signature === "valid" ? "drive.folder.verified" : "drive.folder.unverified")}
          </span>
          {location ? (
            <span className="truncate">· {t("drive.inFolder", { folder: location })}</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function Details({ item, authorLabel }: { item: DriveItem; authorLabel: string }) {
  const { t, i18n } = useTranslation();
  const kind = kindOf(item);
  const rows: Array<[string, ReactNode]> = [
    [t("drive.detailsFields.type"), t(`drive.folder.kind.${kind === "image" ? "file" : kind}`)],
    ...(item.node.kind === "file" && item.meta?.size !== undefined
      ? ([[t("drive.columns.size"), formatBytes(item.meta.size, i18n.language)]] as Array<
          [string, ReactNode]
        >)
      : []),
    [
      t("drive.columns.modified"),
      item.meta ? formatDate(item.meta.modifiedAt, i18n.language) : "—",
    ],
    [t("drive.detailsFields.created"), formatDate(item.node.createdAt, i18n.language)],
    [t("drive.columns.author"), authorLabel],
    [
      t("drive.detailsFields.signature"),
      <span key="sig" className="flex flex-col items-start gap-1">
        <Badge tone={item.signature === "valid" ? "success" : "danger"}>
          {t(item.signature === "valid" ? "drive.folder.verified" : "drive.folder.unverified")}
        </Badge>
        <TrustBadge trust={item.author.trust} />
      </span>,
    ],
    [t("drive.detailsFields.version"), String(item.node.revision)],
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-somnus-primary/10 text-somnus-primary">
          <Icon name={KIND_ICON[kind]} className="h-6 w-6" />
        </span>
        <p className="min-w-0 break-words font-medium text-somnus-text">{item.meta?.name ?? "—"}</p>
      </div>
      <dl className="flex flex-col gap-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-somnus-subtle">{label}</dt>
            <dd className="text-somnus-text">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="flex items-start gap-2 text-xs text-somnus-subtle">
        <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("drive.e2eNote")}
      </p>
    </div>
  );
}

function ShareGrid({
  shares,
  onOpen,
  onCreate,
}: {
  shares: DriveShareEntry[] | null;
  onOpen: (shareId: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  if (shares === null) return <p className="text-sm text-somnus-subtle">{t("drive.loading")}</p>;
  if (shares.length === 0) {
    return (
      <EmptyState icon="folderShared" title={t("drive.shares.empty")}>
        <Button className="mt-4" onClick={onCreate}>
          {t("drive.shares.new")}
        </Button>
      </EmptyState>
    );
  }
  return (
    <section aria-labelledby="drive-shares-heading">
      <h2 id="drive-shares-heading" className="mb-3 text-sm font-semibold text-somnus-subtle">
        {t("drive.sharedFolders")}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shares.map((share) => (
          <li key={share.shareId}>
            <button
              type="button"
              disabled={share.name === null}
              onClick={() => onOpen(share.shareId)}
              className="flex w-full items-center gap-4 rounded-xl border border-white/[0.06] bg-somnus-background/40 p-4 text-left transition hover:border-somnus-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-somnus-primary/10 text-somnus-primary">
                <Icon name="folderShared" className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-somnus-text">
                  {share.name ?? t("drive.shares.unreadable")}
                </span>
                {share.problem ? (
                  <span className="block text-xs text-somnus-danger">
                    {t(`drive.problem.${share.problem}`)}
                  </span>
                ) : (
                  <span className="block text-xs text-somnus-subtle">
                    {t(`drive.role.${share.role}`)} ·{" "}
                    {t("drive.shares.members", { count: share.memberCount })}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NameDialog({
  title,
  label,
  submit,
  initial = "",
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  submit: string;
  initial?: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  function submitForm(event: FormEvent) {
    event.preventDefault();
    const name = value.trim();
    if (name) void onSubmit(name);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submitForm} className="flex flex-col gap-4">
        <Field
          label={label}
          value={value}
          maxLength={200}
          onChange={(e) => setValue(e.target.value)}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("drive.cancel")}
          </Button>
          <Button type="submit" disabled={busy || !value.trim()}>
            {busy ? t("drive.working") : submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MoveDialog({
  view,
  item,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  view: DriveFolderView;
  item: DriveItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (target: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState("");
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
  const targets = [
    { id: view.rootId, name: view.name },
    ...view.items
      .filter((i) => i.node.kind === "folder" && !i.node.trashedAt && !excluded.has(i.node.id))
      .map((i) => ({ id: i.node.id, name: i.meta?.name ?? "—" })),
  ].filter((x) => x.id !== item.node.parentId);
  return (
    <Modal title={t("drive.folder.moveTo")} onClose={onClose}>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {targets.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              aria-pressed={target === x.id}
              onClick={() => setTarget(x.id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${target === x.id ? "bg-somnus-primary/15 text-somnus-text" : "text-somnus-subtle hover:bg-white/5"}`}
            >
              <Icon name="folder" className="h-4 w-4 text-somnus-primary" />
              {x.name}
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("drive.cancel")}
        </Button>
        <Button disabled={busy || !target} onClick={() => void onSubmit(target)}>
          {t("drive.folder.move")}
        </Button>
      </div>
    </Modal>
  );
}
