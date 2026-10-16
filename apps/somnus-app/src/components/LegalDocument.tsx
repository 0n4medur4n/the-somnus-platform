import type { LegalDocumentVersion } from "@somnus/api-contracts";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { twMerge } from "tailwind-merge";
import { Button } from "./Button.js";

type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

/**
 * The stored text is plain: blank lines separate blocks, "## " starts a
 * heading, "- " starts a list item. Parsed here, never rendered as HTML, so a
 * document can carry no markup into the page.
 */
export function parseLegalText(content: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of content.split(/\n\s*\n/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.every((line) => line.startsWith("- "))) {
      blocks.push({ kind: "list", items: lines.map((line) => line.slice(2)) });
      continue;
    }
    for (const line of lines) {
      if (line.startsWith("## ")) blocks.push({ kind: "heading", text: line.slice(3) });
      else if (line.startsWith("- ")) blocks.push({ kind: "list", items: [line.slice(2)] });
      else blocks.push({ kind: "paragraph", text: line });
    }
  }
  return blocks;
}

/** How a draft announces itself, in each language the documents exist in. */
const DRAFT_MARKERS = ["BORRADOR", "DRAFT", "ESBORRANY", "PROJET EN ATTENTE"];

export function isDraftNotice(text: string): boolean {
  return DRAFT_MARKERS.some((marker) => text.startsWith(marker));
}

/** "a1b2 c3d4 … " in groups of four, so the fingerprint can be read aloud or compared. */
export function groupFingerprint(hash: string): string {
  return hash.match(/.{1,4}/g)?.join(" ") ?? hash;
}

export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/**
 * Prints only this document: everything else on the page is hidden by the
 * `body[data-printing]` rules in index.css while the print dialog is open.
 */
function printElement(element: HTMLElement | null): void {
  if (!element) return;
  element.setAttribute("data-print-root", "");
  document.body.setAttribute("data-printing", "");
  const done = () => {
    element.removeAttribute("data-print-root");
    document.body.removeAttribute("data-printing");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Browsers that print synchronously have already fired afterprint.
  setTimeout(done, 0);
}

/**
 * A legal document as a person reads and keeps it: title, version, the date it
 * took effect, the text, and its SHA-256 fingerprint -- the identity of the
 * exact text a consent was given against. `signedAt` turns it into the signed
 * copy of one consent.
 */
export function LegalDocument({
  document: doc,
  signedAt,
  withdrawnAt,
  className,
  bodyClassName,
  scrollable = false,
}: {
  document: LegalDocumentVersion;
  signedAt?: string;
  withdrawnAt?: string;
  className?: string;
  bodyClassName?: string;
  /** The text scrolls inside a fixed height; it then takes focus so it can be read by keyboard. */
  scrollable?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "es";
  const root = useRef<HTMLElement>(null);
  const titleId = useId();
  const [pdfState, setPdfState] = useState<"idle" | "working" | "failed">("idle");

  async function downloadPdf() {
    setPdfState("working");
    try {
      const { downloadLegalPdf } = await import("./legal-pdf.js");
      await downloadLegalPdf({
        document: doc,
        ...(signedAt ? { signedAt } : {}),
        ...(withdrawnAt ? { withdrawnAt } : {}),
        locale,
        t,
      });
      setPdfState("idle");
    } catch {
      setPdfState("failed");
    }
  }

  return (
    <article
      ref={root}
      aria-labelledby={titleId}
      className={twMerge(
        "flex flex-col gap-4 rounded-xl border border-somnus-muted/30 bg-somnus-surface/60 p-5",
        className,
      )}
    >
      <header className="flex flex-col gap-1">
        <h3 id={titleId} className="text-lg font-semibold">
          {t(`legal.title.${doc.purposeKey}`)}
        </h3>
        <p className="text-sm text-somnus-subtle">
          {t("legal.versionLine", {
            version: doc.version,
            date: formatDateTime(doc.effectiveAt, locale),
          })}
        </p>
        {signedAt ? (
          <p className="text-sm font-medium text-somnus-success">
            {t("legal.signedOn", { date: formatDateTime(signedAt, locale) })}
          </p>
        ) : null}
        {withdrawnAt ? (
          <p className="text-sm font-medium text-somnus-danger">
            {t("legal.withdrawnOn", { date: formatDateTime(withdrawnAt, locale) })}
          </p>
        ) : null}
      </header>

      <div
        lang={doc.locale}
        {...(scrollable
          ? { tabIndex: 0, role: "region", "aria-label": t("legal.textRegion") }
          : {})}
        className={twMerge(
          "flex flex-col gap-3 leading-relaxed",
          scrollable &&
            "max-h-[min(70dvh,44rem)] min-h-72 overflow-y-auto rounded-lg border border-somnus-muted/20 bg-somnus-background/40 p-4",
          bodyClassName,
        )}
      >
        {parseLegalText(doc.content).map((block, index) =>
          block.kind === "heading" ? (
            <h4 key={index} className="pt-2 font-semibold">
              {block.text}
            </h4>
          ) : block.kind === "list" ? (
            <ul key={index} className="flex list-disc flex-col gap-1 pl-5">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : isDraftNotice(block.text) ? (
            // A draft says so up front, impossible to miss and not mistakable
            // for approved wording.
            <p
              key={index}
              className="rounded-lg border border-amber-400/60 bg-amber-400/10 p-3 text-sm font-medium"
            >
              {block.text}
            </p>
          ) : (
            <p key={index}>{block.text}</p>
          ),
        )}
      </div>

      <footer className="flex flex-col gap-3 border-t border-somnus-muted/30 pt-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-somnus-subtle">{t("legal.fingerprint")}</p>
          <p className="break-words font-mono text-xs" data-testid="document-fingerprint">
            {groupFingerprint(doc.contentSha256)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 print:hidden sm:items-end">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={downloadPdf} disabled={pdfState === "working"}>
              {pdfState === "working" ? t("legal.pdfWorking") : t("legal.downloadPdf")}
            </Button>
            <Button variant="secondary" onClick={() => printElement(root.current)}>
              {t("legal.print")}
            </Button>
          </div>
          {pdfState === "failed" ? (
            <p role="alert" className="text-sm text-somnus-danger">
              {t("legal.pdfError")}
            </p>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

/**
 * A modal reader for a legal document. Native <dialog>: the browser traps
 * focus, closes on Escape and restores focus to the opener.
 */
export function LegalDocumentDialog({
  document: doc,
  open,
  onClose,
}: {
  document: LegalDocumentVersion | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={doc ? t(`legal.title.${doc.purposeKey}`) : t("legal.loading")}
      className="m-auto w-[min(48rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl border border-somnus-muted/30 bg-somnus-background p-0 text-somnus-text backdrop:bg-black/70"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
        <div className="flex items-center justify-end border-b border-somnus-muted/30 px-4 py-2">
          <Button variant="secondary" onClick={onClose}>
            {t("legal.close")}
          </Button>
        </div>
        <div className="overflow-y-auto p-4">
          {doc ? (
            <LegalDocument document={doc} className="border-0 bg-transparent p-0" />
          ) : (
            <p role="status">{t("legal.loading")}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** A small text button that opens a document, for use inside a consent label line. */
export function ReadDocumentButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-medium text-somnus-primary underline-offset-4 hover:underline"
    >
      {children}
    </button>
  );
}
