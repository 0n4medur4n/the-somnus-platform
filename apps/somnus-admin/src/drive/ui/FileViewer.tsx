import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/ui/Icon.js";
import { EmptyState } from "../../components/ui/ui.js";
import { fromUtf8 } from "../crypto.js";
import { docxToHtml, isDocx, previewPage } from "../documents/import-docx.js";
import { isTextual, PREVIEWABLE_IMAGES } from "./drive-ui.js";

type Preview =
  | { kind: "loading" }
  | { kind: "pdf"; url: string }
  | { kind: "image"; url: string }
  | { kind: "html"; page: string }
  | { kind: "text"; text: string }
  | { kind: "none" };

function isPdf(mime: string | undefined, name: string | undefined): boolean {
  return mime === "application/pdf" || (name ?? "").toLowerCase().endsWith(".pdf");
}

/**
 * A file opened full screen, like a drive's viewer. The bytes were decrypted in
 * this browser; the preview never leaves it. A PDF goes to the browser's own
 * viewer through a blob URL; a Word file is converted here to plain HTML and
 * shown in a sandboxed frame that may run nothing at all.
 */
export function FileViewer({
  name,
  mime,
  bytes,
  canEditAsDocument,
  onEditAsDocument,
  onDownload,
  onClose,
}: {
  name: string;
  mime: string | undefined;
  bytes: Uint8Array;
  canEditAsDocument: boolean;
  onEditAsDocument: () => void;
  onDownload: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const docx = isDocx(mime, name);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    const blobOf = (type: string) => new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
    if (isPdf(mime, name)) {
      url = URL.createObjectURL(blobOf("application/pdf"));
      setPreview({ kind: "pdf", url });
    } else if (mime && PREVIEWABLE_IMAGES.has(mime)) {
      url = URL.createObjectURL(blobOf(mime));
      setPreview({ kind: "image", url });
    } else if (docx) {
      docxToHtml(bytes)
        .then((html) => {
          if (!cancelled) setPreview({ kind: "html", page: previewPage(html) });
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
    };
  }, [bytes, mime, name, docx]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        <Icon name={docx ? "document" : "file"} className="h-5 w-5 shrink-0 text-somnus-primary" />
        <h2 className="min-w-0 flex-1 truncate font-medium text-somnus-text">{name}</h2>
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
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex items-center gap-2 rounded-lg bg-somnus-primary-strong px-3 py-1.5 text-sm font-medium text-white hover:brightness-110"
        >
          <Icon name="download" className="h-4 w-4" />
          {t("drive.folder.download")}
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {preview.kind === "loading" ? (
          <p className="p-8 text-center text-somnus-subtle">{t("drive.loading")}</p>
        ) : null}
        {preview.kind === "pdf" ? (
          <iframe title={name} src={preview.url} className="h-full w-full border-0 bg-white" />
        ) : null}
        {preview.kind === "image" ? (
          <div className="flex h-full items-center justify-center p-6">
            <img src={preview.url} alt={name} className="max-h-full max-w-full rounded-lg" />
          </div>
        ) : null}
        {preview.kind === "html" ? (
          <iframe
            title={name}
            // No allow-* tokens: the converted document can run nothing,
            // submit nothing and navigate nowhere.
            sandbox=""
            srcDoc={preview.page}
            className="mx-auto block h-full w-full max-w-4xl border-0 bg-white"
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
    </div>
  );
}
