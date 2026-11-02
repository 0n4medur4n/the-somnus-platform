import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui/Icon.js";
import { Notice } from "../ui/drive-ui.js";
import {
  blockOf,
  type DriveNote,
  MARK_HEX,
  NOTE_MAX_LENGTH,
  type NoteAnchor,
  orderNotes,
} from "./notes-format.js";
import type { NotesBinding } from "./use-notes.js";

function AnchorChip({ note, blocks }: { note: DriveNote; blocks: readonly string[] }) {
  const { t } = useTranslation();
  const { anchor } = note;
  if (anchor.kind === "general") return null;
  const lost =
    (anchor.kind === "block" || anchor.kind === "text") &&
    blockOf(note, blocks) === null &&
    blocks.length > 0;
  if (anchor.kind === "text") {
    return (
      <span className="flex max-w-full items-start gap-1.5 text-xs font-medium text-amber-200">
        <span
          aria-hidden="true"
          className="mt-0.5 h-3 w-3 shrink-0 rounded-sm"
          style={{ background: MARK_HEX[anchor.color] }}
        />
        <span className="line-clamp-2 min-w-0">
          {lost ? t("drive.notes.lostPlace", { quote: anchor.phrase }) : `«${anchor.phrase}»`}
        </span>
      </span>
    );
  }
  return (
    <span className="block max-w-full truncate text-xs font-medium text-amber-200">
      {anchor.kind === "page"
        ? t("drive.notes.onPage", { page: anchor.page })
        : lost
          ? t("drive.notes.lostPlace", { quote: anchor.quote })
          : `«${anchor.quote}»`}
    </span>
  );
}

/**
 * The notes on a file, beside it. Yellow, so they read as notes and not as the
 * document; a resolved one fades instead of disappearing.
 */
export function NotesPanel({
  notes,
  blocks,
  pages,
  draft,
  focusedBlock,
  onClearDraft,
  onSelect,
  onClose,
  className = "",
}: {
  notes: NotesBinding;
  /** The file's blocks now on screen, to place notes; empty for a PDF. */
  blocks: readonly string[];
  /** A PDF: a note goes on a page, chosen by number. */
  pages: boolean;
  /** Where the next note goes, when the person chose a place. */
  draft: NoteAnchor | null;
  focusedBlock: number | null;
  onClearDraft: () => void;
  onSelect: (note: DriveNote) => void;
  onClose: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [page, setPage] = useState("1");
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const ordered = orderNotes(notes.list, blocks);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" });
  const pageNumber = Number(page);
  const pageValid = Number.isInteger(pageNumber) && pageNumber > 0;

  useEffect(() => {
    if (draft?.kind === "block" || draft?.kind === "text") input.current?.focus();
  }, [draft]);

  useEffect(() => {
    if (focusedBlock === null) return;
    list.current
      ?.querySelector(`[data-block="${focusedBlock}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedBlock]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = text.trim();
    if (!body || (pages && draft?.kind !== "text" && !pageValid)) return;
    const anchor: NoteAnchor =
      draft?.kind === "text"
        ? draft
        : pages
          ? { kind: "page", page: pageNumber }
          : (draft ?? { kind: "general" });
    if (await notes.add(body, anchor)) {
      setText("");
      onClearDraft();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <aside
      aria-label={t("drive.notes.title")}
      className={`flex w-80 shrink-0 flex-col border-l border-white/10 bg-somnus-surface ${className}`}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <h3 className="font-medium text-somnus-text">
          {t("drive.notes.heading", { count: notes.list.length })}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("drive.notes.close")}
          className="rounded-lg p-1.5 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <ol ref={list} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {ordered.length === 0 ? (
          <li className="p-2 text-sm text-somnus-subtle">
            {notes.canEdit
              ? t(pages ? "drive.notes.emptyPdf" : "drive.notes.empty")
              : t("drive.notes.emptyRead")}
          </li>
        ) : null}
        {ordered.map((note) => {
          const block = blockOf(note, blocks);
          return (
            <li
              key={note.id}
              data-block={block ?? undefined}
              className={`rounded-lg border-l-4 p-3 text-sm ${
                note.done
                  ? "border-white/20 bg-white/[0.03] opacity-70"
                  : block !== null && block === focusedBlock
                    ? "border-amber-300 bg-amber-300/25"
                    : "border-amber-300 bg-amber-300/10"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(note)}
                className="block w-full text-left"
                aria-label={t("drive.notes.goTo")}
              >
                <AnchorChip note={note} blocks={blocks} />
                <span
                  className={`mt-1 block whitespace-pre-wrap break-words ${note.text ? "text-somnus-text" : "text-somnus-subtle italic"} ${note.done ? "line-through" : ""}`}
                >
                  {note.text || t("drive.notes.highlightOnly")}
                </span>
              </button>
              <p className="mt-2 truncate text-xs text-somnus-subtle">
                {notes.authorOf(note.authorId)} · {date.format(new Date(note.createdAt))}
              </p>
              <div className="mt-1 flex items-center justify-end gap-2 text-xs text-somnus-subtle">
                {notes.canEdit ? (
                  <>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={note.done}
                        disabled={notes.busy}
                        onChange={(event) => void notes.setDone(note.id, event.target.checked)}
                        className="h-3.5 w-3.5 accent-somnus-primary"
                      />
                      {t("drive.notes.done")}
                    </label>
                    <button
                      type="button"
                      disabled={notes.busy}
                      onClick={() => void notes.remove(note.id)}
                      aria-label={t("drive.notes.delete")}
                      className="rounded p-1 hover:bg-white/10 hover:text-somnus-danger"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {notes.error ? (
        <div className="px-3 pb-2">
          <Notice tone="danger">{notes.error}</Notice>
        </div>
      ) : null}

      {notes.canEdit ? (
        <form onSubmit={submit} className="flex flex-col gap-2 border-t border-white/10 p-3">
          {pages && draft?.kind !== "text" ? (
            <label className="flex items-center gap-2 text-sm text-somnus-subtle">
              {t("drive.notes.page")}
              <input
                type="number"
                min={1}
                value={page}
                onChange={(event) => setPage(event.target.value)}
                className="w-20 rounded-md border border-white/15 bg-somnus-background px-2 py-1 text-somnus-text"
              />
            </label>
          ) : draft?.kind === "block" || draft?.kind === "text" ? (
            <p className="flex items-center gap-2 text-xs text-amber-200">
              <span className="min-w-0 flex-1 truncate">
                «{draft.kind === "text" ? draft.phrase : draft.quote}»
              </span>
              <button
                type="button"
                onClick={onClearDraft}
                aria-label={t("drive.notes.clearPlace")}
                className="rounded p-0.5 text-somnus-subtle hover:bg-white/10"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </p>
          ) : (
            <p className="text-xs text-somnus-subtle">{t("drive.notes.pickPlace")}</p>
          )}
          <label>
            <span className="sr-only">{t("drive.notes.write")}</span>
            <textarea
              ref={input}
              value={text}
              rows={3}
              maxLength={NOTE_MAX_LENGTH}
              placeholder={t("drive.notes.write")}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
              className="w-full resize-y rounded-md border border-white/15 bg-somnus-background px-3 py-2 text-sm text-somnus-text focus:border-somnus-primary focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={
              notes.busy || text.trim() === "" || (pages && draft?.kind !== "text" && !pageValid)
            }
            className="rounded-lg bg-somnus-primary-strong px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
          >
            {notes.busy ? t("drive.working") : t("drive.notes.add")}
          </button>
        </form>
      ) : null}
    </aside>
  );
}
