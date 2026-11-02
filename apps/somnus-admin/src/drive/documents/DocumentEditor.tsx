import type { DriveSpeechLang } from "@somnus/api-contracts";
import type { JSONContent } from "@tiptap/core";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "../../components/ui/Icon.js";
import { Menu, type MenuItem } from "../../components/ui/ui.js";
import { NotesPanel } from "../notes/NotesPanel.js";
import { docBlocks, NoteMarks, noteMarksKey } from "../notes/note-marks.js";
import { blockOf, type DriveNote, type NoteAnchor, phraseAnchor } from "../notes/notes-format.js";
import type { NotesBinding } from "../notes/use-notes.js";
import { DocStats } from "./DocStats.js";
import { ColorPicker, PasswordDialog } from "./DocumentTools.js";
import { documentCode } from "./doc-code.js";
import {
  cleanExtras,
  DEFAULT_FONT,
  DEFAULT_FONT_SIZE,
  DOC_FONT_SIZES,
  DOC_FONTS,
  type DocExtras,
  documentExtensions,
  fileNameFor,
  fontNameOf,
  HIGHLIGHT_COLORS,
  hexOf,
  pointsOf,
  TEXT_COLORS,
} from "./doc-format.js";
import { IMAGE_WIDTHS, imageFromFile, LOGOS, logoImage } from "./doc-image.js";
import { EXPORT_FORMATS, type ExportFormat, exportDocument, PASSWORD_FORMATS } from "./export.js";
import { FooterOptions, PageBand } from "./PageBands.js";
import { openSuggestion, ProofreadControls, type Proofreader } from "./ProofreadTools.js";
import { Proofreading } from "./proofreading.js";
import { blockText, ReadingMark } from "./read-aloud.js";
import { langOf, type VoiceBinding, VoiceControls, VoiceLanguage } from "./VoiceTools.js";

export type SaveOutcome = "saved" | "conflict" | "error";
type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

/** A document's own password: whether it has one, and setting or removing it. */
export type PasswordBinding = {
  locked: boolean;
  /** Takes effect with the next save; null removes the password. */
  set: (password: string | null) => Promise<void>;
};

type PasswordDialogState =
  | { kind: "none" }
  | { kind: "lock" }
  | { kind: "export"; format: (typeof PASSWORD_FORMATS)[number] };

/** Quiet time after the last keystroke before the document saves itself. */
const AUTOSAVE_MS = 2500;

export function saveBlob(blob: Blob, name: string) {
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
  initialExtras,
  documentId,
  readOnly,
  onSave,
  onClose,
  notes,
  password,
  voice,
  proofread,
}: {
  initialTitle: string;
  initialContent: JSONContent;
  /** The page's header, footer and numbering, as saved with the document. */
  initialExtras?: DocExtras | undefined;
  /** The Drive file's identifier: the document's code is made from it. */
  documentId?: string | undefined;
  readOnly: boolean;
  onSave: (title: string, content: JSONContent, extras: DocExtras) => Promise<SaveOutcome>;
  onClose: () => void;
  notes?: NotesBinding | undefined;
  password?: PasswordBinding | undefined;
  /** Dictation and reading aloud; without it the toolbar offers neither. */
  voice?: VoiceBinding | undefined;
  /** AI proofreading (Gemini, EU); without it the toolbar does not offer it. */
  proofread?: Proofreader | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<NoteAnchor | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<number | null>(null);
  const [blocks, setBlocks] = useState<string[]>([]);
  const openNotesAt = useRef((index: number) => {
    setPanelOpen(true);
    setFocusedBlock(index);
  });
  const [status, setStatus] = useState<Status>("saved");
  const [exporting, setExporting] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<PasswordDialogState>({ kind: "none" });
  const pageRef = useRef<HTMLDivElement>(null);
  const openSuggestionAt = useRef<(id: string | null) => void>(() => {});
  const titleRef = useRef(title);
  titleRef.current = title;
  const timer = useRef<number | null>(null);
  const saving = useRef(false);
  const extras = useRef<DocExtras>(cleanExtras(initialExtras));
  const [pageNumbers, setPageNumbers] = useState(extras.current.pageNumbers === true);
  const [code, setCode] = useState<string | undefined>(undefined);
  const [codeCopied, setCodeCopied] = useState(false);

  useEffect(() => {
    if (!documentId) return;
    let live = true;
    void documentCode(documentId).then((value) => {
      if (live) setCode(value);
    });
    return () => {
      live = false;
    };
  }, [documentId]);

  // The header, the footer and the numbering save with the text.
  function changeExtras(change: Partial<DocExtras>) {
    extras.current = { ...extras.current, ...change };
    setStatus((s) => (s === "conflict" ? s : "dirty"));
  }

  async function copyCode() {
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => undefined);
    setCodeCopied(true);
    window.setTimeout(() => setCodeCopied(false), 2000);
  }

  const editor = useEditor({
    extensions: [
      ...documentExtensions(),
      NoteMarks.configure({ onClickBlock: (index) => openNotesAt.current(index) }),
      ReadingMark,
      Proofreading.configure({ onOpen: (id) => openSuggestionAt.current(id) }),
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "somnus-doc",
        "aria-label": t("drive.doc.body"),
      },
    },
    onUpdate: ({ editor: e }) => {
      setStatus((s) => (s === "conflict" ? s : "dirty"));
      setBlocks(docBlocks(e.state.doc).map((block) => block.text));
    },
    // The note about to be written goes on the block the caret is in.
    // A selection within one paragraph: the note goes on those words.
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to, empty, $from } = e.state.selection;
      const found = docBlocks(e.state.doc);
      const index = found.findIndex((b) => $from.pos >= b.pos && $from.pos < b.pos + b.size);
      const block = found[index];
      if (!block) {
        setDraft(null);
        return;
      }
      const node = e.state.doc.nodeAt(block.pos);
      if (!empty && node && to <= block.pos + block.size) {
        const { text, at } = blockText(node, block.pos);
        const start = at.findIndex((p) => p >= from);
        let end = -1;
        at.forEach((p, i) => {
          if (p < to) end = i + 1;
        });
        const anchor =
          start >= 0 && end > start ? phraseAnchor([text], 0, start, end, "yellow") : null;
        if (anchor?.kind === "text") {
          setDraft({ ...anchor, index, quote: block.text });
          return;
        }
      }
      setDraft({ kind: "block", quote: block.text, index });
    },
  });

  openSuggestionAt.current = (id) => {
    if (editor) openSuggestion(editor, id);
  };
  const noteList = notes?.list;
  const hasNotes = (noteList?.length ?? 0) > 0;

  useEffect(() => {
    if (!editor) return;
    setBlocks(docBlocks(editor.state.doc).map((block) => block.text));
  }, [editor]);

  // A document that has notes opens with them showing.
  useEffect(() => {
    if (hasNotes) setPanelOpen(true);
  }, [hasNotes]);

  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(noteMarksKey, noteList ?? []));
  }, [editor, noteList]);

  function selectNote(note: DriveNote) {
    if (!editor) return;
    const found = docBlocks(editor.state.doc);
    const index = blockOf(
      note,
      found.map((block) => block.text),
    );
    const block = index === null ? undefined : found[index];
    if (index === null || !block) return;
    setFocusedBlock(index);
    editor
      .chain()
      .setTextSelection(block.pos + 1)
      .scrollIntoView()
      .run();
  }

  const save = useCallback(async () => {
    if (!editor || readOnly || saving.current) return;
    saving.current = true;
    setStatus("saving");
    const outcome = await onSave(
      titleRef.current.trim() || t("drive.doc.untitled"),
      editor.getJSON(),
      cleanExtras(extras.current),
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

  async function exportAs(format: ExportFormat, filePassword?: string) {
    if (!editor) return;
    setExporting(true);
    try {
      const name = titleRef.current.trim() || t("drive.doc.untitled");
      const blob = await exportDocument(format, editor.getJSON(), name, i18n.language, {
        password: filePassword,
        page: {
          ...cleanExtras(extras.current),
          code,
          labels: {
            code: t("drive.doc.code.label"),
            fingerprint: t("drive.doc.code.fingerprint"),
            page: t("drive.doc.bands.page"),
          },
        },
      });
      saveBlob(blob, fileNameFor(name, format));
    } finally {
      setExporting(false);
    }
  }

  // A new password, or none, is written with a save straight away.
  async function changePassword(next: string | null) {
    if (!password) return;
    await password.set(next);
    await save();
  }

  async function close() {
    if (status === "dirty") await save();
    onClose();
  }

  const exportItems: MenuItem[] = EXPORT_FORMATS.flatMap((format) => [
    {
      label: t(`drive.doc.export.${format}`),
      icon: "download" as const,
      onSelect: () => void exportAs(format),
    },
    ...PASSWORD_FORMATS.filter((f) => f === format).map((f) => ({
      label: t(`drive.doc.export.${f}Password`),
      icon: "lock" as const,
      onSelect: () => setPasswordDialog({ kind: "export", format: f }),
    })),
  ]);

  const passwordItems: MenuItem[] = password?.locked
    ? [
        {
          label: t("drive.doc.password.change"),
          icon: "key",
          onSelect: () => setPasswordDialog({ kind: "lock" }),
        },
        {
          label: t("drive.doc.password.remove"),
          icon: "unlock",
          onSelect: () => void changePassword(null),
        },
      ]
    : [
        {
          label: t("drive.doc.password.add"),
          icon: "lock",
          onSelect: () => setPasswordDialog({ kind: "lock" }),
        },
      ];

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
          {code ? (
            <button
              type="button"
              onClick={() => void copyCode()}
              title={t("drive.doc.code.explain")}
              aria-label={`${t("drive.doc.code.copy")}: ${code}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-0.5 font-mono text-xs tracking-wide text-somnus-text hover:bg-white/5"
            >
              <Icon
                name={codeCopied ? "check" : "fingerprint"}
                className="h-3.5 w-3.5 text-somnus-primary"
              />
              {codeCopied ? t("drive.doc.code.copied") : code}
            </button>
          ) : null}
          {password?.locked ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-somnus-primary/40 px-2 py-0.5 text-xs text-somnus-primary">
              <Icon name="lock" className="h-3.5 w-3.5" />
              {t("drive.doc.password.badge")}
            </span>
          ) : null}
          <span role="status" aria-live="polite" className="text-sm text-somnus-subtle">
            {readOnly ? t("drive.doc.readOnly") : t(`drive.doc.status.${status}`)}
          </span>
          {password && !readOnly ? (
            <Menu
              label={t("drive.doc.password.menu")}
              items={passwordItems}
              trigger={({ onClick, expanded }) => (
                <button
                  type="button"
                  onClick={onClick}
                  aria-haspopup="menu"
                  aria-expanded={expanded}
                  title={t("drive.doc.password.menu")}
                  aria-label={t("drive.doc.password.menu")}
                  className="rounded-lg border border-white/15 p-1.5 text-somnus-text hover:bg-white/5"
                >
                  <Icon name={password.locked ? "lock" : "unlock"} className="h-4 w-4" />
                </button>
              )}
            />
          ) : null}
          {notes ? (
            <button
              type="button"
              onClick={() => setPanelOpen((open) => !open)}
              aria-pressed={panelOpen}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5 ${
                panelOpen ? "border-amber-300/60 bg-amber-300/10" : "border-white/15"
              }`}
            >
              <Icon name="note" className="h-4 w-4" />
              {t("drive.notes.heading", { count: notes.list.length })}
            </button>
          ) : null}
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
        {editor && !readOnly ? (
          <Toolbar
            editor={editor}
            voice={voice}
            proofread={proofread}
            onComment={notes?.canEdit ? () => setPanelOpen(true) : undefined}
          />
        ) : null}
      </header>

      {passwordDialog.kind === "lock" ? (
        <PasswordDialog
          title={t(password?.locked ? "drive.doc.password.change" : "drive.doc.password.add")}
          intro={t("drive.doc.password.lockIntro")}
          warning={t("drive.doc.password.lockWarning")}
          submitLabel={t("drive.doc.password.apply")}
          onClose={() => setPasswordDialog({ kind: "none" })}
          onSubmit={async (value) => {
            await changePassword(value);
            setPasswordDialog({ kind: "none" });
          }}
        />
      ) : null}
      {passwordDialog.kind === "export" ? (
        <PasswordDialog
          title={t(`drive.doc.export.${passwordDialog.format}Password`)}
          intro={t("drive.doc.password.exportIntro")}
          warning={t("drive.doc.password.exportWarning")}
          submitLabel={t("drive.doc.password.download")}
          onClose={() => setPasswordDialog({ kind: "none" })}
          onSubmit={async (value) => {
            await exportAs(passwordDialog.format, value);
            setPasswordDialog({ kind: "none" });
          }}
        />
      ) : null}

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

      <div className="flex flex-1">
        <main className="min-w-0 flex-1 overflow-x-auto px-4 py-8">
          {/* An A4 sheet with Google Docs' 2.54 cm margins; it grows a page at a
            time, and a faint line marks where each printed page ends. */}
          <div
            ref={pageRef}
            className="somnus-page mx-auto text-[#202124] shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
          >
            <PageBand
              kind="header"
              initial={extras.current.header}
              title={title}
              readOnly={readOnly}
              onChange={(header) => changeExtras({ header })}
            />
            <EditorContent editor={editor} />
            <PageBand
              kind="footer"
              initial={extras.current.footer}
              title={title}
              readOnly={readOnly}
              onChange={(footer) => changeExtras({ footer })}
            />
            <FooterOptions
              code={code}
              pageNumbers={pageNumbers}
              readOnly={readOnly}
              onPageNumbers={(on) => {
                setPageNumbers(on);
                changeExtras({ pageNumbers: on });
              }}
            />
          </div>
          {editor ? <DocStats editor={editor} page={pageRef} /> : null}
        </main>
        {notes && panelOpen ? (
          <NotesPanel
            notes={notes}
            blocks={blocks}
            pages={false}
            draft={draft}
            focusedBlock={focusedBlock}
            onClearDraft={() => setDraft(null)}
            onSelect={selectNote}
            onClose={() => setPanelOpen(false)}
            className="sticky top-[6.5rem] h-[calc(100vh-6.5rem)] self-start"
          />
        ) : null}
      </div>
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

function Toolbar({
  editor,
  voice,
  proofread,
  onComment,
}: {
  editor: Editor;
  voice: VoiceBinding | undefined;
  proofread: Proofreader | undefined;
  /** Opens the notes beside the page, the selected words ready to comment on. */
  onComment: (() => void) | undefined;
}) {
  const { i18n } = useTranslation();
  const [lang, setLang] = useState<DriveSpeechLang>(() => langOf(i18n.language));
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
      image: e.isActive("image"),
      imageWidth: Number(e.getAttributes("image")["width"]) || 50,
      imageAlign: String(e.getAttributes("image")["align"] ?? "center"),
      task: e.isActive("taskList"),
      inList: e.isActive("listItem") || e.isActive("taskItem"),
      sub: e.isActive("subscript"),
      sup: e.isActive("superscript"),
      font: fontNameOf(e.getAttributes("textStyle")["fontFamily"]) ?? DEFAULT_FONT,
      size: pointsOf(e.getAttributes("textStyle")["fontSize"]) ?? DEFAULT_FONT_SIZE,
      color: hexOf(e.getAttributes("textStyle")["color"]),
      highlight: e.isActive("highlight")
        ? (hexOf(e.getAttributes("highlight")["color"]) ?? HIGHLIGHT_COLORS[0])
        : null,
      align:
        (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ??
        "left",
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const pictureInput = useRef<HTMLInputElement>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);

  // A picture goes in where the caret is, at half the page's width, centred.
  async function insertPicture(
    pending: Promise<{ src: string; width: number; height: number } | null>,
    alt: string,
  ) {
    setPictureError(null);
    const picture = await pending.catch(() => null);
    if (!picture) {
      setPictureError(t("drive.doc.image.failed"));
      return;
    }
    chain()
      .insertContent({
        type: "image",
        attrs: {
          src: picture.src,
          alt,
          width: 50,
          align: "center",
          naturalWidth: picture.width,
          naturalHeight: picture.height,
        },
      })
      .run();
  }

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
      <label className="ml-1">
        <span className="sr-only">{t("drive.doc.tools.font")}</span>
        <select
          value={state.font}
          onChange={(event) => {
            const font = DOC_FONTS.find((f) => f.name === event.target.value);
            if (!font) return;
            if (font.name === DEFAULT_FONT) chain().unsetFontFamily().run();
            else chain().setFontFamily(font.css).run();
          }}
          className="w-36 rounded-md border border-white/10 bg-somnus-background px-2 py-1 text-sm text-somnus-text"
        >
          {!DOC_FONTS.some((f) => f.name === state.font) ? (
            <option value={state.font}>{state.font}</option>
          ) : null}
          <optgroup label={t("drive.doc.tools.brandFonts")}>
            {DOC_FONTS.filter((f) => f.brand).map((f) => (
              <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
                {f.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t("drive.doc.tools.otherFonts")}>
            {DOC_FONTS.filter((f) => !f.brand).map((f) => (
              <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>
                {f.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <label className="ml-1">
        <span className="sr-only">{t("drive.doc.tools.size")}</span>
        <select
          value={String(state.size)}
          onChange={(event) => {
            const size = Number(event.target.value);
            if (size === DEFAULT_FONT_SIZE) chain().unsetFontSize().run();
            else chain().setFontSize(`${size}pt`).run();
          }}
          className="w-16 rounded-md border border-white/10 bg-somnus-background px-1 py-1 text-sm text-somnus-text"
        >
          {!DOC_FONT_SIZES.some((size) => size === state.size) ? (
            <option value={String(state.size)}>{state.size}</option>
          ) : null}
          {DOC_FONT_SIZES.map((size) => (
            <option key={size} value={String(size)}>
              {size}
            </option>
          ))}
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
        icon="subscript"
        label={t("drive.doc.tools.subscript")}
        active={state.sub}
        onClick={() => chain().unsetSuperscript().toggleSubscript().run()}
      />
      <ToolButton
        icon="superscript"
        label={t("drive.doc.tools.superscript")}
        active={state.sup}
        onClick={() => chain().unsetSubscript().toggleSuperscript().run()}
      />
      <ColorPicker
        icon="textColor"
        label={t("drive.doc.tools.color")}
        colors={TEXT_COLORS}
        current={state.color}
        noneLabel={t("drive.doc.tools.colorNone")}
        onPick={(color) => chain().setColor(color).run()}
        onNone={() => chain().unsetColor().run()}
      />
      <ColorPicker
        icon="highlighter"
        label={t("drive.doc.tools.highlight")}
        colors={HIGHLIGHT_COLORS}
        current={state.highlight}
        noneLabel={t("drive.doc.tools.highlightNone")}
        onPick={(color) => chain().setHighlight({ color }).run()}
        onNone={() => chain().unsetHighlight().run()}
      />
      <ToolButton
        icon="clearFormat"
        label={t("drive.doc.tools.clear")}
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      />
      {onComment ? (
        <ToolButton icon="note" label={t("drive.notes.comment")} onClick={onComment} />
      ) : null}
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
        active={state.image ? state.imageAlign === "left" : state.align === "left"}
        onClick={() =>
          state.image
            ? chain().updateAttributes("image", { align: "left" }).run()
            : chain().setTextAlign("left").run()
        }
      />
      <ToolButton
        icon="alignCenter"
        label={t("drive.doc.tools.alignCenter")}
        active={state.image ? state.imageAlign === "center" : state.align === "center"}
        onClick={() =>
          state.image
            ? chain().updateAttributes("image", { align: "center" }).run()
            : chain().setTextAlign("center").run()
        }
      />
      <ToolButton
        icon="alignRight"
        label={t("drive.doc.tools.alignRight")}
        active={state.image ? state.imageAlign === "right" : state.align === "right"}
        onClick={() =>
          state.image
            ? chain().updateAttributes("image", { align: "right" }).run()
            : chain().setTextAlign("right").run()
        }
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
        icon="checklist"
        label={t("drive.doc.tools.taskList")}
        active={state.task}
        onClick={() => chain().toggleTaskList().run()}
      />
      <ToolButton
        icon="outdent"
        label={t("drive.doc.tools.outdent")}
        disabled={!state.inList}
        onClick={() =>
          state.task
            ? chain().liftListItem("taskItem").run()
            : chain().liftListItem("listItem").run()
        }
      />
      <ToolButton
        icon="indent"
        label={t("drive.doc.tools.indent")}
        disabled={!state.inList}
        onClick={() =>
          state.task
            ? chain().sinkListItem("taskItem").run()
            : chain().sinkListItem("listItem").run()
        }
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
      <Menu
        label={t("drive.doc.image.menu")}
        items={[
          ...LOGOS.map((logo) => ({
            label: t(`drive.doc.image.logos.${logo.key}`),
            icon: "star" as const,
            onSelect: () =>
              void insertPicture(logoImage(logo.path), t(`drive.doc.image.logos.${logo.key}`)),
          })),
          {
            label: t("drive.doc.image.upload"),
            icon: "upload" as const,
            onSelect: () => pictureInput.current?.click(),
          },
        ]}
        trigger={({ onClick, expanded }) => (
          <button
            type="button"
            title={t("drive.doc.image.menu")}
            aria-label={t("drive.doc.image.menu")}
            aria-haspopup="menu"
            aria-expanded={expanded}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
            className="rounded-md p-1.5 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
          >
            <Icon name="image" className="h-[18px] w-[18px]" />
          </button>
        )}
      />
      <input
        ref={pictureInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertPicture(imageFromFile(file), file.name);
        }}
      />
      {state.image ? (
        <label className="ml-1">
          <span className="sr-only">{t("drive.doc.image.width")}</span>
          <select
            value={String(state.imageWidth)}
            onChange={(event) =>
              chain()
                .updateAttributes("image", { width: Number(event.target.value) })
                .run()
            }
            title={t("drive.doc.image.width")}
            className="rounded-md border border-white/10 bg-somnus-background px-1 py-1 text-sm text-somnus-text"
          >
            {IMAGE_WIDTHS.map((w) => (
              <option key={w} value={String(w)}>
                {w} %
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {pictureError ? (
        <span role="alert" className="ml-1 text-xs text-somnus-danger">
          {pictureError}
        </span>
      ) : null}
      {voice || proofread ? (
        <>
          <Divider />
          <VoiceLanguage lang={lang} onChange={setLang} />
          {voice ? <VoiceControls editor={editor} voice={voice} lang={lang} /> : null}
          {proofread ? (
            <ProofreadControls editor={editor} lang={lang} proofread={proofread} />
          ) : null}
        </>
      ) : null}

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
