import type { JSONContent } from "@tiptap/core";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import { Menu, type MenuItem } from "../../components/ui/ui.js";
import { documentExtensions, fileNameFor } from "./doc-format.js";
import { EXPORT_FORMATS, type ExportFormat, exportDocument } from "./export.js";

export type SaveOutcome = "saved" | "conflict" | "error";
type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

/** Quiet time after the last keystroke before the document saves itself. */
const AUTOSAVE_MS = 2500;

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * A Drive document, full page, like a word processor (owner decision
 * 2026-10-19). Every save is a new encrypted revision of the same Drive file,
 * written by `onSave`; this component only holds the decrypted text in memory.
 * Exports are produced here too, from what is on screen.
 */
export function DocumentEditor({
  initialTitle,
  initialContent,
  readOnly,
  onSave,
  onClose,
}: {
  initialTitle: string;
  initialContent: JSONContent;
  readOnly: boolean;
  onSave: (title: string, content: JSONContent) => Promise<SaveOutcome>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<Status>("saved");
  const [exporting, setExporting] = useState(false);
  const titleRef = useRef(title);
  titleRef.current = title;
  const timer = useRef<number | null>(null);
  const saving = useRef(false);

  const editor = useEditor({
    extensions: documentExtensions(),
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "somnus-doc",
        "aria-label": t("drive.doc.body"),
      },
    },
    onUpdate: () => setStatus((s) => (s === "conflict" ? s : "dirty")),
  });

  const save = useCallback(async () => {
    if (!editor || readOnly || saving.current) return;
    saving.current = true;
    setStatus("saving");
    const outcome = await onSave(
      titleRef.current.trim() || t("drive.doc.untitled"),
      editor.getJSON(),
    );
    saving.current = false;
    setStatus(outcome === "saved" ? "saved" : outcome);
  }, [editor, onSave, readOnly, t]);

  // Save on its own a moment after typing stops.
  useEffect(() => {
    if (status !== "dirty" || readOnly) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [status, save, readOnly]);

  // Ctrl/Cmd+S saves now; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    const onLeave = (event: BeforeUnloadEvent) => {
      if (status === "dirty" || status === "saving") event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [save, status]);

  async function exportAs(format: ExportFormat) {
    if (!editor) return;
    setExporting(true);
    try {
      const name = titleRef.current.trim() || t("drive.doc.untitled");
      const blob = await exportDocument(format, editor.getJSON(), name, i18n.language);
      saveBlob(blob, fileNameFor(name, format));
    } finally {
      setExporting(false);
    }
  }

  async function close() {
    if (status === "dirty") await save();
    onClose();
  }

  const exportItems: MenuItem[] = EXPORT_FORMATS.map((format) => ({
    label: t(`drive.doc.export.${format}`),
    icon: "download" as const,
    onSelect: () => void exportAs(format),
  }));

  return (
    <div className="flex min-h-screen flex-col bg-somnus-background">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-somnus-surface/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => void close()}
            aria-label={t("drive.doc.back")}
            className="rounded-lg p-2 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
          >
            <Icon name="arrowLeft" />
          </button>
          <Icon name="document" className="h-6 w-6 shrink-0 text-somnus-primary" />
          <label className="min-w-0 flex-1">
            <span className="sr-only">{t("drive.doc.title")}</span>
            <input
              value={title}
              readOnly={readOnly}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
                setStatus((s) => (s === "conflict" ? s : "dirty"));
              }}
              placeholder={t("drive.doc.untitled")}
              className="w-full truncate rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-medium text-somnus-text hover:border-white/10 focus:border-somnus-primary focus:outline-none"
            />
          </label>
          <span role="status" aria-live="polite" className="text-sm text-somnus-subtle">
            {readOnly ? t("drive.doc.readOnly") : t(`drive.doc.status.${status}`)}
          </span>
          <Menu
            label={t("drive.doc.export.title")}
            items={exportItems}
            trigger={({ onClick, expanded }) => (
              <button
                type="button"
                onClick={onClick}
                aria-haspopup="menu"
                aria-expanded={expanded}
                disabled={exporting}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5 disabled:opacity-60"
              >
                <Icon name="download" className="h-4 w-4" />
                {exporting ? t("drive.working") : t("drive.doc.export.title")}
              </button>
            )}
          />
          {readOnly ? null : (
            <button
              type="button"
              onClick={() => void save()}
              disabled={status === "saving" || status === "saved"}
              className="inline-flex items-center gap-2 rounded-lg bg-somnus-primary-strong px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
            >
              <Icon name="save" className="h-4 w-4" />
              {t("drive.doc.save")}
            </button>
          )}
        </div>
        {editor && !readOnly ? <Toolbar editor={editor} /> : null}
      </header>

      {status === "conflict" ? (
        <p
          role="alert"
          className="mx-auto mt-4 max-w-3xl rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-200"
        >
          {t("drive.doc.conflict")}
        </p>
      ) : null}
      {status === "error" ? (
        <p
          role="alert"
          className="mx-auto mt-4 max-w-3xl rounded-lg border border-somnus-danger/40 px-4 py-2 text-sm text-somnus-danger"
        >
          {t("drive.doc.saveFailed")}
        </p>
      ) : null}

      <main className="flex-1 overflow-x-auto px-4 py-8">
        {/* An A4 sheet with Google Docs' 2.54 cm margins; it grows a page at a
            time, and a faint line marks where each printed page ends. */}
        <div className="somnus-page mx-auto text-[#202124] shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
          <EditorContent editor={editor} />
        </div>
      </main>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`rounded-md p-1.5 ${
        active
          ? "bg-somnus-primary/20 text-somnus-primary"
          : "text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
      } disabled:opacity-40`}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/10" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "p",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
      align:
        (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ??
        "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  function applyLink(event: FormEvent) {
    event.preventDefault();
    const value = href.trim();
    if (!value) chain().unsetLink().run();
    else
      chain()
        .extendMarkRange("link")
        .setLink({ href: /^[a-z]+:/i.test(value) ? value : `https://${value}` })
        .run();
    setLinking(false);
    setHref("");
  }

  return (
    <div
      role="toolbar"
      aria-label={t("drive.doc.toolbar")}
      className="flex flex-wrap items-center gap-0.5 border-t border-white/5 px-3 py-1.5"
    >
      <ToolButton
        icon="undo"
        label={t("drive.doc.tools.undo")}
        disabled={!state.canUndo}
        onClick={() => chain().undo().run()}
      />
      <ToolButton
        icon="redo"
        label={t("drive.doc.tools.redo")}
        disabled={!state.canRedo}
        onClick={() => chain().redo().run()}
      />
      <Divider />
      <label>
        <span className="sr-only">{t("drive.doc.tools.style")}</span>
        <select
          value={state.block}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "p") chain().setParagraph().run();
            else
              chain()
                .toggleHeading({ level: Number(value.slice(1)) as 1 | 2 | 3 })
                .run();
          }}
          className="rounded-md border border-white/10 bg-somnus-background px-2 py-1 text-sm text-somnus-text"
        >
          <option value="p">{t("drive.doc.tools.paragraph")}</option>
          <option value="h1">{t("drive.doc.tools.h1")}</option>
          <option value="h2">{t("drive.doc.tools.h2")}</option>
          <option value="h3">{t("drive.doc.tools.h3")}</option>
        </select>
      </label>
      <Divider />
      <ToolButton
        icon="bold"
        label={t("drive.doc.tools.bold")}
        active={state.bold}
        onClick={() => chain().toggleBold().run()}
      />
      <ToolButton
        icon="italic"
        label={t("drive.doc.tools.italic")}
        active={state.italic}
        onClick={() => chain().toggleItalic().run()}
      />
      <ToolButton
        icon="underline"
        label={t("drive.doc.tools.underline")}
        active={state.underline}
        onClick={() => chain().toggleUnderline().run()}
      />
      <ToolButton
        icon="strike"
        label={t("drive.doc.tools.strike")}
        active={state.strike}
        onClick={() => chain().toggleStrike().run()}
      />
      <ToolButton
        icon="link"
        label={t("drive.doc.tools.link")}
        active={state.link || linking}
        onClick={() => {
          setHref(String(editor.getAttributes("link")["href"] ?? ""));
          setLinking((v) => !v);
        }}
      />
      <Divider />
      <ToolButton
        icon="alignLeft"
        label={t("drive.doc.tools.alignLeft")}
        active={state.align === "left"}
        onClick={() => chain().setTextAlign("left").run()}
      />
      <ToolButton
        icon="alignCenter"
        label={t("drive.doc.tools.alignCenter")}
        active={state.align === "center"}
        onClick={() => chain().setTextAlign("center").run()}
      />
      <ToolButton
        icon="alignRight"
        label={t("drive.doc.tools.alignRight")}
        active={state.align === "right"}
        onClick={() => chain().setTextAlign("right").run()}
      />
      <ToolButton
        icon="alignJustify"
        label={t("drive.doc.tools.alignJustify")}
        active={state.align === "justify"}
        onClick={() => chain().setTextAlign("justify").run()}
      />
      <Divider />
      <ToolButton
        icon="listBullet"
        label={t("drive.doc.tools.bulletList")}
        active={state.bullet}
        onClick={() => chain().toggleBulletList().run()}
      />
      <ToolButton
        icon="listOrdered"
        label={t("drive.doc.tools.orderedList")}
        active={state.ordered}
        onClick={() => chain().toggleOrderedList().run()}
      />
      <ToolButton
        icon="quote"
        label={t("drive.doc.tools.quote")}
        active={state.quote}
        onClick={() => chain().toggleBlockquote().run()}
      />
      <ToolButton
        icon="code"
        label={t("drive.doc.tools.codeBlock")}
        active={state.code}
        onClick={() => chain().toggleCodeBlock().run()}
      />
      <ToolButton
        icon="minus"
        label={t("drive.doc.tools.rule")}
        onClick={() => chain().setHorizontalRule().run()}
      />
      <Divider />
      <ToolButton
        icon="table"
        label={t("drive.doc.tools.table")}
        active={state.table}
        onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      />
      {state.table ? (
        <span className="ml-1 flex flex-wrap items-center gap-1 text-xs">
          {(
            [
              ["addRowAfter", () => chain().addRowAfter().run()],
              ["addColumnAfter", () => chain().addColumnAfter().run()],
              ["deleteRow", () => chain().deleteRow().run()],
              ["deleteColumn", () => chain().deleteColumn().run()],
              ["deleteTable", () => chain().deleteTable().run()],
            ] as const
          ).map(([key, action]) => (
            <button
              key={key}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={action}
              className="rounded-md border border-white/10 px-2 py-1 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
            >
              {t(`drive.doc.tools.${key}`)}
            </button>
          ))}
        </span>
      ) : null}
      {linking ? (
        <form onSubmit={applyLink} className="ml-2 flex items-center gap-1">
          <label>
            <span className="sr-only">{t("drive.doc.tools.linkUrl")}</span>
            <input
              ref={(input) => input?.focus()}
              type="url"
              value={href}
              placeholder="https://"
              onChange={(event) => setHref(event.target.value)}
              className="w-56 rounded-md border border-white/10 bg-somnus-background px-2 py-1 text-sm text-somnus-text"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-somnus-primary-strong px-2 py-1 text-xs text-white"
          >
            {t("drive.doc.tools.applyLink")}
          </button>
        </form>
      ) : null}
    </div>
  );
}
