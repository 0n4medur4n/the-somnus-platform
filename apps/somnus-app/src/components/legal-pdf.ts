import type { LegalDocumentVersion } from "@somnus/api-contracts";
import type { TFunction } from "i18next";
import {
  formatDateTime,
  groupFingerprint,
  isDraftNotice,
  parseLegalText,
} from "./LegalDocument.js";

/** What goes into the downloaded copy, already in the reader's language. */
export type LegalPdfInput = {
  document: LegalDocumentVersion;
  signedAt?: string;
  withdrawnAt?: string;
  locale: string;
  t: TFunction;
};

export function legalPdfFileName(doc: LegalDocumentVersion): string {
  return `the-somnus-${doc.purposeKey.replaceAll("_", "-")}-v${doc.version}-${doc.locale}.pdf`;
}

const PAGE = { width: 210, height: 297, margin: 20 } as const;
const LINE = 1.45;

/**
 * Builds the PDF copy of a legal document -- the signed copy when `signedAt`
 * is given -- and downloads it. The same text, version and SHA-256 fingerprint
 * the page shows, so the file can be checked against the record at any time.
 *
 * jsPDF is loaded only here, on demand: nobody pays for it until they ask for
 * a file. Text only (the built-in Helvetica covers es, en, ca and fr).
 */
export async function downloadLegalPdf(input: LegalPdfInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const { document: doc, signedAt, withdrawnAt, locale, t } = input;
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const width = PAGE.width - PAGE.margin * 2;
  let y = PAGE.margin;

  const ensure = (height: number) => {
    if (y + height > PAGE.height - PAGE.margin - 8) {
      pdf.addPage();
      y = PAGE.margin;
    }
  };
  const write = (
    text: string,
    options: {
      size: number;
      style?: "normal" | "bold";
      font?: string;
      indent?: number;
      gap?: number;
    },
  ) => {
    pdf.setFont(options.font ?? "helvetica", options.style ?? "normal");
    pdf.setFontSize(options.size);
    const indent = options.indent ?? 0;
    const lines = pdf.splitTextToSize(text, width - indent) as string[];
    const lineHeight = (options.size * 0.3528 * LINE) as number;
    for (const line of lines) {
      ensure(lineHeight);
      pdf.text(line, PAGE.margin + indent, y + lineHeight * 0.75);
      y += lineHeight;
    }
    y += options.gap ?? 0;
  };

  pdf.setProperties({
    title: t(`legal.title.${doc.purposeKey}`),
    subject: `v${doc.version} (${doc.locale}) sha256:${doc.contentSha256}`,
    creator: "The Somnus",
  });

  write("The Somnus", { size: 10, style: "bold", gap: 4 });
  write(t(`legal.title.${doc.purposeKey}`), { size: 17, style: "bold", gap: 2 });
  write(
    t("legal.versionLine", { version: doc.version, date: formatDateTime(doc.effectiveAt, locale) }),
    { size: 10, gap: 1 },
  );
  if (signedAt) {
    write(t("legal.signedOn", { date: formatDateTime(signedAt, locale) }), {
      size: 10,
      style: "bold",
      gap: 1,
    });
  }
  if (withdrawnAt) {
    write(t("legal.withdrawnOn", { date: formatDateTime(withdrawnAt, locale) }), {
      size: 10,
      style: "bold",
      gap: 1,
    });
  }
  y += 4;

  for (const block of parseLegalText(doc.content)) {
    if (block.kind === "heading") {
      y += 2;
      write(block.text, { size: 12, style: "bold", gap: 1.5 });
    } else if (block.kind === "list") {
      for (const item of block.items) write(`•  ${item}`, { size: 10.5, indent: 3, gap: 1 });
      y += 1.5;
    } else {
      write(block.text, {
        size: 10.5,
        style: isDraftNotice(block.text) ? "bold" : "normal",
        gap: 2.5,
      });
    }
  }

  ensure(30);
  y += 4;
  pdf.setDrawColor(160);
  pdf.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
  y += 5;
  write(t("legal.fingerprint"), { size: 9, gap: 1 });
  write(groupFingerprint(doc.contentSha256), { size: 9, font: "courier", gap: 3 });
  write(t("legal.pdfGeneratedOn", { date: formatDateTime(new Date().toISOString(), locale) }), {
    size: 8,
  });

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(
      t("legal.pdfPage", { page, pages }),
      PAGE.width - PAGE.margin,
      PAGE.height - PAGE.margin / 2,
      { align: "right" },
    );
  }

  pdf.save(legalPdfFileName(doc));
}
