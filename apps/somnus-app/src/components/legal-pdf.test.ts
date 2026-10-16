import type { LegalDocumentVersion } from "@somnus/api-contracts";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../test/utils.js";
import { isDraftNotice } from "./LegalDocument.js";
import { downloadLegalPdf, legalPdfFileName } from "./legal-pdf.js";

const DOC: LegalDocumentVersion = {
  id: "019fe7a0-0003-7000-8000-000000000003",
  purposeKey: "health_data_processing",
  title: "Consentimiento",
  version: 2,
  locale: "es",
  content:
    "BORRADOR PENDIENTE DE REVISIÓN LEGAL. Versión de trabajo.\n\n## Qué datos\nTus respuestas a las preguntas de seguridad.\n\n- Primera línea\n- Segunda línea",
  contentSha256: "a".repeat(64),
  effectiveAt: "2026-10-15T10:00:00.000Z",
};

// The real jsPDF builds the file; only the browser download at the end is
// replaced, so the test reads the bytes that would have been saved.
const saved = vi.hoisted(() => ({ bytes: "", name: "" }));
vi.mock("jspdf", async (importOriginal) => {
  const real = await importOriginal<typeof import("jspdf")>();
  class CapturingPdf extends real.jsPDF {
    constructor(...args: ConstructorParameters<typeof real.jsPDF>) {
      super(...args);
      this.save = ((file: string) => {
        saved.bytes = this.output();
        saved.name = file;
        return this;
      }) as unknown as typeof this.save;
    }
  }
  return { ...real, jsPDF: CapturingPdf };
});

describe("legal PDF copy", () => {
  it("is a real PDF holding the text, the version, the signature date and the fingerprint", async () => {
    await downloadLegalPdf({
      document: DOC,
      signedAt: "2026-10-16T09:30:00.000Z",
      locale: "es",
      t: i18n.t.bind(i18n),
    });

    const { bytes, name } = saved;
    expect(bytes.startsWith("%PDF-")).toBe(true);
    expect(name).toBe("the-somnus-health-data-processing-v2-es.pdf");
    expect(bytes).toContain("Tus respuestas a las preguntas de seguridad.");
    expect(bytes).toContain("aaaa aaaa");
    expect(bytes).toContain(i18n.t("legal.pdfPage", { page: 1, pages: 1 }).replace(/[()\\]/g, ""));
    expect(bytes).toContain("sha256:".concat("a".repeat(64)));
  });

  it("names the file after the document, version and language", () => {
    expect(legalPdfFileName({ ...DOC, purposeKey: "terms_acceptance", locale: "fr" })).toBe(
      "the-somnus-terms-acceptance-v2-fr.pdf",
    );
  });
});

describe("draft notice", () => {
  it("is recognised in every language the documents exist in", () => {
    for (const text of [
      "BORRADOR PENDIENTE DE REVISIÓN LEGAL.",
      "DRAFT PENDING LEGAL REVIEW.",
      "ESBORRANY PENDENT DE REVISIÓ LEGAL.",
      "PROJET EN ATTENTE DE RÉVISION JURIDIQUE.",
    ]) {
      expect(isDraftNotice(text)).toBe(true);
    }
    expect(isDraftNotice("## 1. Qué es The Somnus")).toBe(false);
  });
});
