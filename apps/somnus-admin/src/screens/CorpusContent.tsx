import {
  CORPUS_FILE_CONTENT_TYPES,
  CORPUS_FILE_MAX_BYTES,
  type CorpusDocument,
} from "@somnus/api-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiRequestError } from "../lib/api.js";
import { edge } from "../lib/edge.js";

/**
 * Where a corpus document's text comes from (owner decision 2026-10-18): typed,
 * an uploaded PDF or Word original (kept, and downloadable), or one web page.
 * Whichever it is, the text lands in a DRAFT and then follows every corpus rule
 * unchanged -- rights before publishing, embedding only on publish.
 */
export type ContentSource = "text" | "file" | "web";

const PDF = CORPUS_FILE_CONTENT_TYPES[0];
const DOCX = CORPUS_FILE_CONTENT_TYPES[1];

/** The type to send for a picked file, or null when it is neither PDF nor Word. */
export function corpusFileType(file: File): string | null {
  if ((CORPUS_FILE_CONTENT_TYPES as readonly string[]).includes(file.type)) return file.type;
  // Some systems give no type at all; the extension is then the only hint. The
  // report service decides from the bytes either way.
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return PDF;
  if (name.endsWith(".docx")) return DOCX;
  return null;
}

/** Why a picked file cannot be sent, as an i18n key -- or null when it can. */
export function corpusFileProblem(file: File | null): string | null {
  if (!file) return "corpus.content.fileMissing";
  if (corpusFileType(file) === null) return "corpus.content.fileType";
  if (file.size === 0) return "corpus.content.fileEmpty";
  if (file.size > CORPUS_FILE_MAX_BYTES) return "corpus.content.fileTooLarge";
  return null;
}

export function webUrlProblem(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? null
      : "corpus.content.urlInvalid";
  } catch {
    return "corpus.content.urlInvalid";
  }
}

/** Sends a draft its file or page. Throws what the server said. */
export async function applyCorpusContent(
  documentId: string,
  source: ContentSource,
  file: File | null,
  url: string,
): Promise<CorpusDocument | null> {
  if (source === "file" && file) {
    const type = corpusFileType(file);
    if (!type) return null;
    return edge.uploadCorpusFile(documentId, file, type);
  }
  if (source === "web") return edge.fetchCorpusWebPage(documentId, { url: url.trim() });
  return null;
}

/** The i18n key for a failed file or page, by what the server answered. */
export function contentErrorKey(error: unknown, source: ContentSource): string {
  if (error instanceof ApiRequestError && error.reason === "CORPUS_INPUT_REFUSED") {
    return source === "web" ? "corpus.content.pageRefused" : "corpus.content.fileRefused";
  }
  if (error instanceof ApiRequestError && error.status === 409) return "errors.conflict";
  if (error instanceof ApiRequestError && error.status === 413) {
    return "corpus.content.fileTooLarge";
  }
  return "errors.generic";
}

function formatSize(bytes: number, language: string): string {
  const units = ["B", "KB", "MB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

/** The source picker and its input, inside the corpus form. */
export function ContentSourcePicker({
  idPrefix,
  source,
  text,
  file,
  url,
  onSource,
  onText,
  onFile,
  onUrl,
}: {
  idPrefix: string;
  source: ContentSource;
  text: string;
  file: File | null;
  url: string;
  onSource: (next: ContentSource) => void;
  onText: (next: string) => void;
  onFile: (next: File | null) => void;
  onUrl: (next: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const problem = source === "file" && file ? corpusFileProblem(file) : null;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-somnus-border p-3">
      <legend className="px-1 text-sm font-semibold text-somnus-text">
        {t("corpus.content.title")}
      </legend>
      <div
        role="radiogroup"
        aria-label={t("corpus.content.title")}
        className="flex flex-wrap gap-2"
      >
        {(["text", "file", "web"] as const).map((value) => (
          <label
            key={value}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
              source === value
                ? "border-somnus-primary bg-somnus-primary/15 text-somnus-text"
                : "border-white/10 text-somnus-subtle hover:bg-white/5"
            }`}
          >
            <input
              type="radio"
              name={`${idPrefix}-content-source`}
              value={value}
              checked={source === value}
              onChange={() => onSource(value)}
              className="sr-only"
            />
            {t(`corpus.content.source.${value}`)}
          </label>
        ))}
      </div>

      {source === "text" ? (
        <>
          <label htmlFor={`${idPrefix}-text`} className="text-sm font-medium text-somnus-text">
            {t("corpus.textLabel")}
          </label>
          <p id={`${idPrefix}-text-hint`} className="text-sm text-somnus-subtle">
            {t("corpus.textHint")}
          </p>
          <textarea
            id={`${idPrefix}-text`}
            aria-describedby={`${idPrefix}-text-hint`}
            rows={8}
            className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2 text-somnus-text"
            value={text}
            onChange={(event) => onText(event.target.value)}
          />
        </>
      ) : null}

      {source === "file" ? (
        <>
          <label htmlFor={`${idPrefix}-file`} className="text-sm font-medium text-somnus-text">
            {t("corpus.content.fileLabel")}
          </label>
          <p id={`${idPrefix}-file-hint`} className="text-sm text-somnus-subtle">
            {t("corpus.content.fileHint")}
          </p>
          <input
            id={`${idPrefix}-file`}
            type="file"
            aria-describedby={`${idPrefix}-file-hint`}
            accept={`.pdf,.docx,${PDF},${DOCX}`}
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            className="text-sm text-somnus-text file:mr-3 file:rounded-md file:border-0 file:bg-somnus-primary-strong file:px-3 file:py-1.5 file:text-white"
          />
          {file ? (
            <p className="text-sm text-somnus-subtle">
              {file.name} · {formatSize(file.size, i18n.language)}
            </p>
          ) : null}
          {problem ? (
            <p role="alert" className="text-sm text-somnus-danger">
              {t(problem)}
            </p>
          ) : null}
        </>
      ) : null}

      {source === "web" ? (
        <>
          <label htmlFor={`${idPrefix}-url`} className="text-sm font-medium text-somnus-text">
            {t("corpus.content.urlLabel")}
          </label>
          <p id={`${idPrefix}-url-hint`} className="text-sm text-somnus-subtle">
            {t("corpus.content.urlHint")}
          </p>
          <input
            id={`${idPrefix}-url`}
            type="url"
            inputMode="url"
            placeholder="https://"
            aria-describedby={`${idPrefix}-url-hint`}
            value={url}
            onChange={(event) => onUrl(event.target.value)}
            className="rounded-md border border-somnus-muted/40 bg-somnus-surface px-3 py-2 text-somnus-text"
          />
        </>
      ) : null}
    </fieldset>
  );
}

/** Where a listed document's text came from, with the way back to it. */
export function CorpusOriginLine({ document }: { document: CorpusDocument }) {
  const { t, i18n } = useTranslation();
  const [failed, setFailed] = useState(false);
  const origin = document.origin;
  if (!origin) return null;

  async function download() {
    setFailed(false);
    try {
      const { blob, filename } = await edge.downloadCorpusFile(document.id);
      const href = URL.createObjectURL(blob);
      const link = Object.assign(window.document.createElement("a"), {
        href,
        download: filename,
      });
      window.document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-somnus-subtle">
      {origin.kind === "file" ? (
        <>
          <span>
            {t("corpus.content.fromFile", { name: origin.filename ?? "" })}
            {origin.sizeBytes ? ` · ${formatSize(origin.sizeBytes, i18n.language)}` : ""}
          </span>
          <button
            type="button"
            onClick={() => void download()}
            className="text-somnus-primary underline hover:no-underline"
          >
            {t("corpus.content.download")}
          </button>
          {failed ? (
            <span role="alert" className="text-somnus-danger">
              {t("errors.generic")}
            </span>
          ) : null}
        </>
      ) : (
        <>
          <span>{t("corpus.content.fromPage")}</span>
          <a
            // The server only ever stores an http(s) address; checked again
            // here so a stored value can never become a script link.
            href={/^https?:\/\//i.test(origin.sourceUrl ?? "") ? (origin.sourceUrl ?? "") : "#"}
            target="_blank"
            rel="noreferrer noopener"
            className="max-w-full truncate text-somnus-primary underline hover:no-underline"
          >
            {origin.sourceUrl}
          </a>
        </>
      )}
    </p>
  );
}
