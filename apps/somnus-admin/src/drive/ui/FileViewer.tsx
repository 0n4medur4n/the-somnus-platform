import type { DriveSpeechLang } from "@somnus/api-contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui/Icon.js";
import { LoadingRegion, Skeleton, SkeletonLines } from "../../components/ui/Skeleton.js";
import { EmptyState } from "../../components/ui/ui.js";
import { fromUtf8 } from "../crypto.js";
import { htmlViewerPage, isHtml } from "../documents/html-view.js";
import { docxToHtml, isDocx, previewPage } from "../documents/import-docx.js";
import { isMarkdown, markdownPage, markdownToHtml } from "../documents/markdown.js";
import { passagesOfTexts, wordRange } from "../documents/read-aloud.js";
import {
  langOf,
  ReadAloudButton,
  type VoiceBinding,
  VoiceLanguage,
} from "../documents/VoiceTools.js";
import { AnnotatedFrame } from "../notes/AnnotatedFrame.js";
import { NotesPanel } from "../notes/NotesPanel.js";
import {
  blockOf,
  type DriveNote,
  MARK_COLORS,
  marksFor,
  type NoteAnchor,
  normalizeQuote,
  phraseAnchor,
  textMarksFor,
} from "../notes/notes-format.js";
import type { NotesBinding } from "../notes/use-notes.js";
import { PdfFrame } from "../pdf/PdfFrame.js";
import { csvToSheets, isSheetFile, isXlsx, xlsxToSheets } from "../sheets/convert.js";
import { SheetFrame } from "../sheets/SheetFrame.js";
import type { StoredSheet } from "../sheets/sheet-format.js";
import { isTextual, PREVIEWABLE_IMAGES } from "./drive-ui.js";

type Preview =
  | { kind: "loading" }
  | { kind: "pdf"; url: string }
  | { kind: "image"; url: string }
  | { kind: "html"; page: string }
  | { kind: "markdown"; page: string }
  | { kind: "webpage"; page: string }
  | { kind: "sheet"; sheets: StoredSheet[] }
  | { kind: "text"; text: string }
  | { kind: "none" };

function isPdf(mime: string | undefined, name: string | undefined): boolean {
  return mime === "application/pdf" || (name ?? "").toLowerCase().endsWith(".pdf");
}

/**
 * A file opened full screen, like a drive's viewer. The bytes were decrypted in
 * this browser; the preview never leaves it. A PDF opens in our own viewer
 * (pdf.js, in an isolated frame: see `PdfFrame`), so it can be read aloud, and in
 * the browser's own viewer in a tab of its own; a Word file is converted here to plain HTML and
 * shown in a sandboxed frame that may run nothing at all. Markdown takes the
 * same road, a spreadsheet opens read-only in its own isolated frame, and an HTML
 * file runs in one too, here or in a tab of its own (see `htmlViewerPage`).
 *
 * A PDF, a Word file or Markdown can carry notes. Until a file has one, or the
 * panel is opened, it stays in the frame that may run nothing; from then on the
 * frame also runs the note script, and only that (see `annotatedPage`).
 */
export function FileViewer({
  name,
  mime,
  bytes,
  canEditAsDocument,
  onEditAsDocument,
  canEditAsSheet,
  onEditAsSheet,
  onDownload,
  onClose,
  notes,
  voice,
}: {
  name: string;
  mime: string | undefined;
  bytes: Uint8Array;
  canEditAsDocument: boolean;
  onEditAsDocument: () => void;
  canEditAsSheet: boolean;
  onEditAsSheet: () => void;
  onDownload: () => void;
  onClose: () => void;
  notes?: NotesBinding | undefined;
  /** Reading aloud, for Markdown and Word previews. */
  voice?: VoiceBinding | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [voiceLang, setVoiceLang] = useState<DriveSpeechLang>(() => langOf(i18n.language));
  const [reading, setReading] = useState<{ index: number | null; start?: number; end?: number }>({
    index: null,
  });
  const fullBlocks = useRef<string[] | null>(null);
  // The whole texts the marks are placed in: a preview's blocks, or a PDF's pages.
  const [wholeTexts, setWholeTexts] = useState<string[]>([]);
  const fullWaiters = useRef<Array<(texts: string[]) => void>>([]);
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const docx = isDocx(mime, name);
  const sheet = isSheetFile(mime, name);
  const tabUrl = useRef<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [blocks, setBlocks] = useState<string[]>([]);
  const [draft, setDraft] = useState<NoteAnchor | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<number | null>(null);
  const [goTo, setGoTo] = useState<{ index: number; nonce: number } | null>(null);
  const [pdfGoTo, setPdfGoTo] = useState<{ page: number; nonce: number } | null>(null);
  const [pdfReading, setPdfReading] = useState<{
    page: number | null;
    start?: number;
    end?: number;
  }>({ page: null });
  const pdfTexts = useRef<string[] | null>(null);
  const pdfWaiters = useRef<Array<(texts: string[]) => void>>([]);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fullBlocks.current = null;
    pdfTexts.current = null;
    setWholeTexts([]);
    const blobOf = (type: string) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
    if (isPdf(mime, name)) {
      url = URL.createObjectURL(blobOf("application/pdf"));
      setPreview({ kind: "pdf", url });
    } else if (mime && PREVIEWABLE_IMAGES.has(mime)) {
      url = URL.createObjectURL(blobOf(mime));
      setPreview({ kind: "image", url });
    } else if (isHtml(mime, name)) {
      setPreview({ kind: "webpage", page: htmlViewerPage(name ?? "", fromUtf8(bytes)) });
    } else if (docx) {
      docxToHtml(bytes)
        .then((html) => {
          if (!cancelled) setPreview({ kind: "html", page: previewPage(html) });
        })
        .catch(() => {
          if (!cancelled) setPreview({ kind: "none" });
        });
    } else if (isMarkdown(mime, name)) {
      markdownToHtml(fromUtf8(bytes))
        .then((html) => {
          if (!cancelled) setPreview({ kind: "markdown", page: markdownPage(html) });
        })
        .catch(() => {
          if (!cancelled) setPreview({ kind: "text", text: fromUtf8(bytes) });
        });
    } else if (sheet) {
      (isXlsx(mime, name)
        ? xlsxToSheets(bytes)
        : Promise.resolve(csvToSheets(fromUtf8(bytes), name))
      )
        .then((sheets) => {
          if (!cancelled) setPreview({ kind: "sheet", sheets });
        })
        .catch(() => {
          if (!cancelled) setPreview({ kind: "none" });
        });
    } else if (isTextual(mime)) {
      setPreview({ kind: "text", text: fromUtf8(bytes) });
    } else {
      setPreview({ kind: "none" });
    }
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      // Closing the file takes back the decrypted copy a tab could reload from.
      if (tabUrl.current) URL.revokeObjectURL(tabUrl.current);
      tabUrl.current = null;
    };
  }, [bytes, mime, name, docx, sheet]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const notable = preview.kind === "pdf" || preview.kind === "markdown" || preview.kind === "html";
  const hasNotes = (notes?.list.length ?? 0) > 0;

  // A file that has notes opens with them showing.
  useEffect(() => {
    if (hasNotes) {
      setAnnotating(true);
      setPanelOpen(true);
    }
  }, [hasNotes]);

  const marks = useMemo(() => marksFor(notes?.list ?? [], blocks), [notes?.list, blocks]);
  // Marked phrases, and what the selection bar says: one object while nothing
  // changes, so the frame is not told the same thing again.
  const phrases = useMemo(
    () => ({
      marks: textMarksFor(notes?.list ?? [], wholeTexts),
      labels: {
        comment: t("drive.notes.comment"),
        colors: Object.fromEntries(MARK_COLORS.map((c) => [c, t(`drive.notes.colors.${c}`)])),
      },
    }),
    [notes?.list, wholeTexts, t],
  );

  // A selection in the file: a coloured mark at once, or a comment to write.
  async function onSelect(choice: {
    index: number;
    start: number;
    end: number;
    color: string;
    comment: boolean;
  }) {
    if (!notes?.canEdit) return;
    const color = MARK_COLORS.find((c) => c === choice.color) ?? "yellow";
    const anchor = phraseAnchor(wholeTexts, choice.index, choice.start, choice.end, color);
    if (!anchor) return;
    if (choice.comment) {
      setPanelOpen(true);
      setDraft(anchor);
    } else {
      await notes.add("", anchor);
    }
  }

  function togglePanel() {
    setAnnotating(true);
    setPanelOpen((open) => !open);
  }

  function addAt(index: number) {
    const text = blocks[index];
    if (text === undefined) return;
    setPanelOpen(true);
    setDraft({ kind: "block", quote: normalizeQuote(text), index });
  }

  function selectNote(note: DriveNote) {
    if (note.anchor.kind === "page") setPdfGoTo({ page: note.anchor.page, nonce: Date.now() });
    if (note.anchor.kind === "text" && preview.kind === "pdf") {
      setPdfGoTo({ page: note.anchor.index + 1, nonce: Date.now() });
      return;
    }
    const index = blockOf(note, blocks);
    if (index === null) return;
    setFocusedBlock(index);
    setGoTo({ index, nonce: Date.now() });
  }

  function frameFor(page: string, sandbox: string, className: string) {
    return (
      <AnnotatedFrame
        title={name}
        page={page}
        sandbox={sandbox}
        className={className}
        marks={marks}
        canAdd={notes?.canEdit ?? false}
        addLabel={t("drive.notes.addHere")}
        goTo={goTo}
        reading={reading}
        phrases={notes ? phrases : undefined}
        onSelect={(choice) => void onSelect(choice)}
        onBlocks={setBlocks}
        onFullBlocks={onFullBlocks}
        onAdd={addAt}
        onFocus={(index) => {
          setPanelOpen(true);
          setFocusedBlock(index);
        }}
        onFailed={() => setPreview({ kind: "none" })}
      />
    );
  }

  // The frame reads only once it runs the note script; until then, wait for it.
  function readableBlocks(): Promise<string[]> {
    if (fullBlocks.current) return Promise.resolve(fullBlocks.current);
    setAnnotating(true);
    return new Promise((resolve) => {
      fullWaiters.current.push(resolve);
      setTimeout(() => resolve([]), 10_000);
    });
  }

  // A PDF's pages arrive once the viewer has read the file.
  function pdfPages(): Promise<string[]> {
    if (pdfTexts.current) return Promise.resolve(pdfTexts.current);
    return new Promise((resolve) => {
      pdfWaiters.current.push(resolve);
      setTimeout(() => resolve([]), 20_000);
    });
  }

  function onPdfPages(texts: string[]) {
    pdfTexts.current = texts;
    setWholeTexts(texts);
    for (const resolve of pdfWaiters.current.splice(0)) resolve(texts);
  }

  function onFullBlocks(texts: string[]) {
    fullBlocks.current = texts;
    setWholeTexts(texts);
    for (const resolve of fullWaiters.current.splice(0)) resolve(texts);
  }

  function openInTab(page: string) {
    tabUrl.current ??= URL.createObjectURL(new Blob([page], { type: "text/html;charset=utf-8" }));
    window.open(tabUrl.current, "_blank", "noopener");
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
    >
      <header className="flex items-center gap-3 border-b border-white/10 bg-somnus-surface px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.close")}
          className="rounded-lg p-2 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
        >
          <Icon name="arrowLeft" />
        </button>
        <Icon
          name={sheet ? "table" : docx ? "document" : "file"}
          className="h-5 w-5 shrink-0 text-somnus-primary"
        />
        <h2 className="min-w-0 flex-1 truncate font-medium text-somnus-text">{name}</h2>
        {voice && preview.kind === "pdf" ? (
          <span className="flex items-center gap-1">
            <VoiceLanguage lang={voiceLang} onChange={setVoiceLang} />
            <ReadAloudButton
              voice={voice}
              lang={voiceLang}
              collect={async () => passagesOfTexts(await pdfPages())}
              onPassage={(passage) => setPdfReading({ page: passage ? passage.from + 1 : null })}
              onWord={(passage, word) => {
                const range = word && wordRange(passage, word[0], word[1]);
                setPdfReading(
                  range
                    ? { page: passage.from + 1, start: range[0], end: range[1] }
                    : { page: passage.from + 1 },
                );
              }}
            />
          </span>
        ) : null}
        {voice && (preview.kind === "markdown" || preview.kind === "html") ? (
          <span className="flex items-center gap-1">
            <VoiceLanguage lang={voiceLang} onChange={setVoiceLang} />
            <ReadAloudButton
              voice={voice}
              lang={voiceLang}
              collect={async () => passagesOfTexts(await readableBlocks())}
              onPassage={(passage) => setReading({ index: passage ? passage.from : null })}
              onWord={(passage, word) => {
                const range = word && wordRange(passage, word[0], word[1]);
                setReading(
                  range
                    ? { index: passage.from, start: range[0], end: range[1] }
                    : { index: passage.from },
                );
              }}
            />
          </span>
        ) : null}
        {notes && notable ? (
          <button
            type="button"
            onClick={togglePanel}
            aria-pressed={panelOpen}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5 ${
              panelOpen ? "border-amber-300/60 bg-amber-300/10" : "border-white/15"
            }`}
          >
            <Icon name="note" className="h-4 w-4" />
            {t("drive.notes.heading", { count: notes.list.length })}
          </button>
        ) : null}
        {preview.kind === "pdf" ? (
          <button
            type="button"
            onClick={() => window.open(preview.url, "_blank", "noopener")}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
          >
            <Icon name="external" className="h-4 w-4" />
            {t("drive.viewer.openInTab")}
          </button>
        ) : null}
        {preview.kind === "webpage" ? (
          <button
            type="button"
            onClick={() => openInTab(preview.page)}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
          >
            <Icon name="external" className="h-4 w-4" />
            {t("drive.viewer.openInTab")}
          </button>
        ) : null}
        {docx && canEditAsDocument ? (
          <button
            type="button"
            onClick={onEditAsDocument}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
          >
            <Icon name="pencil" className="h-4 w-4" />
            {t("drive.viewer.editAsDocument")}
          </button>
        ) : null}
        {sheet && canEditAsSheet ? (
          <button
            type="button"
            onClick={onEditAsSheet}
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-somnus-text hover:bg-white/5"
          >
            <Icon name="pencil" className="h-4 w-4" />
            {t("drive.viewer.editAsSheet")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-lg bg-somnus-primary-strong px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
        >
          <Icon name="download" className="h-4 w-4" />
          {t("drive.folder.download")}
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {preview.kind === "loading" ? (
            <LoadingRegion
              message={t("drive.loading")}
              className="mx-auto flex max-w-2xl flex-col gap-4 p-8"
            >
              <Skeleton className="h-7 w-1/2" />
              <SkeletonLines lines={5} />
              <SkeletonLines lines={4} />
            </LoadingRegion>
          ) : null}
          {preview.kind === "pdf" ? (
            <PdfFrame
              title={name}
              bytes={bytes}
              goTo={pdfGoTo}
              reading={pdfReading}
              phrases={notes ? phrases : undefined}
              onSelect={(choice) => void onSelect(choice)}
              onPages={onPdfPages}
              onFailed={() => setPreview({ kind: "none" })}
            />
          ) : null}
          {preview.kind === "image" ? (
            <div className="flex h-full items-center justify-center p-6">
              <img src={preview.url} alt={name} className="max-h-full max-w-full rounded-lg" />
            </div>
          ) : null}
          {preview.kind === "html" && annotating
            ? frameFor(
                preview.page,
                "allow-scripts",
                "mx-auto block h-full w-full max-w-4xl border-0 bg-white",
              )
            : null}
          {preview.kind === "html" && !annotating ? (
            <iframe
              title={name}
              // No allow-* tokens: the converted document can run nothing,
              // submit nothing and navigate nowhere.
              sandbox=""
              srcDoc={preview.page}
              className="mx-auto block h-full w-full max-w-4xl border-0 bg-white"
            />
          ) : null}
          {preview.kind === "webpage" ? (
            <iframe
              title={name}
              sandbox="allow-scripts"
              allow="clipboard-write"
              srcDoc={preview.page}
              className="block h-full w-full border-0 bg-white"
            />
          ) : null}
          {preview.kind === "markdown" && annotating
            ? frameFor(
                preview.page,
                "allow-scripts allow-popups allow-popups-to-escape-sandbox",
                "block h-full w-full border-0 bg-white",
              )
            : null}
          {preview.kind === "markdown" && !annotating ? (
            <iframe
              title={name}
              // It can still run nothing; the one addition is that a link may
              // open in a new tab, and only http, https and mail links survive.
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={preview.page}
              className="block h-full w-full border-0 bg-white"
            />
          ) : null}
          {preview.kind === "sheet" ? (
            <SheetFrame
              title={name}
              sheets={preview.sheets}
              readOnly
              onFailed={() => setPreview({ kind: "none" })}
            />
          ) : null}
          {preview.kind === "text" ? (
            <pre className="mx-auto max-w-4xl whitespace-pre-wrap break-words p-8 text-sm text-somnus-text">
              {preview.text}
            </pre>
          ) : null}
          {preview.kind === "none" ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon="file" title={t("drive.preview.noPreview")} />
            </div>
          ) : null}
        </div>
        {notes && notable && panelOpen ? (
          <NotesPanel
            notes={notes}
            blocks={blocks}
            pages={preview.kind === "pdf"}
            draft={draft}
            focusedBlock={focusedBlock}
            onClearDraft={() => setDraft(null)}
            onSelect={selectNote}
            onClose={() => setPanelOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
