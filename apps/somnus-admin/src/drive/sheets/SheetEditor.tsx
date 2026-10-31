import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui/Icon.js";
import { Menu, type MenuItem } from "../../components/ui/ui.js";
import { type SaveOutcome, saveBlob } from "../documents/DocumentEditor.js";
import { fileNameFor } from "../documents/doc-format.js";
import { SHEET_EXPORTS, type SheetExport, sheetsToXlsx, sheetToCsv } from "./convert.js";
import { SheetFrame, type SheetFrameHandle } from "./SheetFrame.js";
import type { StoredSheet } from "./sheet-format.js";

type Status = "saved" | "dirty" | "saving" | "error" | "conflict";

/** Quiet time after the last edit before the workbook saves itself. */
const AUTOSAVE_MS = 2500;

/**
 * A Drive spreadsheet, full page. Like a document, every save is a new encrypted
 * revision of the same Drive file, written by `onSave`, and exports are produced
 * here from what is on screen. The grid itself lives in `SheetFrame`.
 */
export function SheetEditor({
  initialTitle,
  initialSheets,
  readOnly,
  onSave,
  onClose,
}: {
  initialTitle: string;
  initialSheets: StoredSheet[];
  readOnly: boolean;
  onSave: (title: string, sheets: StoredSheet[]) => Promise<SaveOutcome>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<Status>("saved");
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const frame = useRef<SheetFrameHandle>(null);
  const titleRef = useRef(title);
  titleRef.current = title;
  const saving = useRef(false);

  const save = useCallback(async () => {
    if (readOnly || saving.current || !frame.current) return;
    saving.current = true;
    setStatus("saving");
    try {
      const sheets = await frame.current.snapshot();
      const outcome = await onSave(titleRef.current.trim() || t("drive.sheet.untitled"), sheets);
      setStatus(outcome === "saved" ? "saved" : outcome);
    } catch {
      setStatus("error");
    } finally {
      saving.current = false;
    }
  }, [onSave, readOnly, t]);

  const markDirty = useCallback(() => setStatus((s) => (s === "conflict" ? s : "dirty")), []);

  useEffect(() => {
    if (status !== "dirty" || readOnly) return;
    const timer = window.setTimeout(() => void save(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [status, save, readOnly]);

  // Ctrl/Cmd+S with the focus outside the grid (inside it, the frame reports
  // the key); leaving with unsaved changes asks first.
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

  async function exportAs(format: SheetExport) {
    if (!frame.current) return;
    setExporting(true);
    try {
      const sheets = await frame.current.snapshot();
      const name = titleRef.current.trim() || t("drive.sheet.untitled");
      if (format === "xlsx") {
        saveBlob(await sheetsToXlsx(sheets), fileNameFor(name, "xlsx"));
        return;
      }
      const active = sheets.find((sheet) => sheet.status === 1) ?? sheets[0];
      if (!active) return;
      // A spreadsheet in Spanish expects semicolons: commas are its decimals.
      const separator = i18n.language.startsWith("es") ? ";" : ",";
      const blob = new Blob([sheetToCsv(active, separator)], { type: "text/csv" });
      saveBlob(blob, fileNameFor(name, "csv"));
    } finally {
      setExporting(false);
    }
  }

  async function close() {
    if (status === "dirty") await save();
    onClose();
  }

  const exportItems: MenuItem[] = SHEET_EXPORTS.map((format) => ({
    label: t(`drive.sheet.export.${format}`),
    icon: "download" as const,
    onSelect: () => void exportAs(format),
  }));

  return (
    <div className="flex h-screen flex-col bg-somnus-background">
      <header className="z-20 flex flex-wrap items-center gap-3 border-b border-white/10 bg-somnus-surface px-4 py-2.5">
        <button
          type="button"
          onClick={() => void close()}
          aria-label={t("drive.doc.back")}
          className="rounded-lg p-2 text-somnus-subtle hover:bg-white/10 hover:text-somnus-text"
        >
          <Icon name="arrowLeft" />
        </button>
        <Icon name="table" className="h-6 w-6 shrink-0 text-somnus-primary" />
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("drive.sheet.title")}</span>
          <input
            value={title}
            readOnly={readOnly}
            maxLength={200}
            onChange={(event) => {
              setTitle(event.target.value);
              markDirty();
            }}
            placeholder={t("drive.sheet.untitled")}
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
      </header>

      {status === "conflict" ? (
        <p
          role="alert"
          className="border-b border-amber-400/40 bg-amber-400/10 px-4 py-2 text-sm text-amber-200"
        >
          {t("drive.doc.conflict")}
        </p>
      ) : null}
      {status === "error" ? (
        <p
          role="alert"
          className="border-b border-somnus-danger/40 px-4 py-2 text-sm text-somnus-danger"
        >
          {t("drive.doc.saveFailed")}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="px-4 py-2 text-sm text-somnus-danger">
          {t("drive.sheet.failed")}
        </p>
      ) : null}

      <main className="min-h-0 flex-1">
        <SheetFrame
          ref={frame}
          title={title || t("drive.sheet.untitled")}
          sheets={initialSheets}
          readOnly={readOnly}
          onChanged={markDirty}
          onSaveKey={() => void save()}
          onFailed={() => setFailed(true)}
        />
      </main>
    </div>
  );
}
