import type { CorpusDocument } from "@somnus/api-contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/api.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const mocks = vi.hoisted(() => ({
  searchCorpus: vi.fn(),
  corpusDocument: vi.fn(),
  createCorpusDocument: vi.fn(),
  editCorpusDocument: vi.fn(),
  publishCorpusDocument: vi.fn(),
  retireCorpusDocument: vi.fn(),
  corpusSources: vi.fn(),
  uploadCorpusFile: vi.fn(),
  fetchCorpusWebPage: vi.fn(),
  downloadCorpusFile: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: mocks }));

const { CorpusScreen } = await import("./CorpusScreen.js");
const { corpusFileProblem, corpusFileType, webUrlProblem } = await import("./CorpusContent.js");

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars ?? {});
const PDF_TYPE = "application/pdf";

function document_(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: "doc-1",
    title: "Guía de higiene",
    citation: "The Somnus (2026).",
    sourceType: "guideline",
    locale: "es",
    status: "draft",
    rightsStatus: "own_document",
    rightsEvidence: {},
    addedBy: "018f0000-0000-7000-8000-000000000abc",
    corpusVersionAdded: null,
    corpusVersionRetired: null,
    retiredReason: null,
    scopes: [{ scopeType: "module", scopeKey: "INS" }],
    chunkCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchCorpus.mockResolvedValue({ documents: [], currentVersion: 0 });
});

async function fillDocument() {
  await userEvent.type(screen.getByLabelText(t("corpus.titleLabel")), "Guía de higiene");
  await userEvent.type(screen.getByLabelText(t("corpus.citationLabel")), "The Somnus (2026).");
  // The form's own scope key (the search filters above carry the same label).
  await userEvent.type(document.getElementById("corpus-scope-key-0") as HTMLElement, "INS");
}

/** Owner decision 2026-10-18: a draft's text from a PDF/Word original or one web page. */
describe("corpus content sources", () => {
  it("accepts PDF and Word by type or extension, and nothing else", () => {
    expect(corpusFileType(new File(["x"], "a.pdf", { type: PDF_TYPE }))).toBe(PDF_TYPE);
    expect(corpusFileType(new File(["x"], "informe.DOCX"))).toContain("wordprocessingml");
    expect(corpusFileType(new File(["x"], "foto.png", { type: "image/png" }))).toBeNull();
    expect(corpusFileProblem(null)).toBe("corpus.content.fileMissing");
    expect(corpusFileProblem(new File([], "a.pdf", { type: PDF_TYPE }))).toBe(
      "corpus.content.fileEmpty",
    );
    expect(webUrlProblem("https://example.org/guia")).toBeNull();
    expect(webUrlProblem("javascript:alert(1)")).toBe("corpus.content.urlInvalid");
    expect(webUrlProblem("example.org")).toBe("corpus.content.urlInvalid");
  });

  it("creates the draft without text, then uploads the PDF into it", async () => {
    mocks.createCorpusDocument.mockResolvedValue(document_({ id: "new-doc" }));
    mocks.uploadCorpusFile.mockResolvedValue(document_({ id: "new-doc", chunkCount: 3 }));
    renderWithProviders(<CorpusScreen />);
    await fillDocument();

    await userEvent.click(screen.getByLabelText(t("corpus.content.source.file")));
    const file = new File(["%PDF-1.4 hola"], "guía.pdf", { type: PDF_TYPE });
    await userEvent.upload(screen.getByLabelText(t("corpus.content.fileLabel")), file);
    await userEvent.click(screen.getByRole("button", { name: t("corpus.create") }));

    await waitFor(() => expect(mocks.uploadCorpusFile).toHaveBeenCalledTimes(1));
    expect(mocks.createCorpusDocument.mock.calls[0]?.[0]).not.toHaveProperty("text");
    expect(mocks.uploadCorpusFile).toHaveBeenCalledWith("new-doc", file, PDF_TYPE);
    // Back to an empty form: the draft, with its text, is now in the list.
    await waitFor(() => expect(mocks.searchCorpus).toHaveBeenCalledTimes(2));
  });

  it("fetches a web page into the draft it just created", async () => {
    mocks.createCorpusDocument.mockResolvedValue(document_({ id: "new-doc" }));
    mocks.fetchCorpusWebPage.mockResolvedValue(document_({ id: "new-doc", chunkCount: 2 }));
    renderWithProviders(<CorpusScreen />);
    await fillDocument();

    await userEvent.click(screen.getByLabelText(t("corpus.content.source.web")));
    const create = screen.getByRole("button", { name: t("corpus.create") });
    expect(create).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(t("corpus.content.urlLabel")),
      "https://example.org/guia",
    );
    await userEvent.click(create);

    await waitFor(() =>
      expect(mocks.fetchCorpusWebPage).toHaveBeenCalledWith("new-doc", {
        url: "https://example.org/guia",
      }),
    );
  });

  it("says why a refused file failed, and keeps the form on the new draft", async () => {
    mocks.createCorpusDocument.mockResolvedValue(document_({ id: "new-doc" }));
    mocks.uploadCorpusFile.mockRejectedValue(
      new ApiRequestError(400, "VALIDATION_FAILED", "no", "CORPUS_INPUT_REFUSED"),
    );
    renderWithProviders(<CorpusScreen />);
    await fillDocument();
    await userEvent.click(screen.getByLabelText(t("corpus.content.source.file")));
    await userEvent.upload(
      screen.getByLabelText(t("corpus.content.fileLabel")),
      new File(["%PDF-1.4"], "escaneado.pdf", { type: PDF_TYPE }),
    );
    await userEvent.click(screen.getByRole("button", { name: t("corpus.create") }));

    expect(await screen.findByText(t("corpus.content.fileRefused"))).toBeVisible();
    // Now editing the draft that was created, so a retry does not create another.
    expect(screen.getByRole("button", { name: t("corpus.save") })).toBeVisible();
  });

  it("shows where a document's text came from, and downloads the original", async () => {
    mocks.searchCorpus.mockResolvedValue({
      documents: [
        document_({
          id: "with-file",
          title: "Con archivo",
          origin: {
            kind: "file",
            filename: "Guía.pdf",
            contentType: PDF_TYPE,
            sizeBytes: 2048,
            sourceUrl: null,
            addedAt: "2026-10-18T10:00:00.000Z",
          },
        }),
        document_({
          id: "with-page",
          title: "Con página",
          origin: {
            kind: "web_page",
            sourceUrl: "https://example.org/guia",
            addedAt: "2026-10-18T10:00:00.000Z",
          },
        }),
      ],
      currentVersion: 0,
    });
    mocks.downloadCorpusFile.mockResolvedValue({ blob: new Blob(["x"]), filename: "Guía.pdf" });
    const createObjectURL = vi.fn(() => "blob:fake");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithProviders(<CorpusScreen />);
    expect(
      await screen.findByText(t("corpus.content.fromFile", { name: "Guía.pdf" }), {
        exact: false,
      }),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: "https://example.org/guia" });
    expect(link).toHaveAttribute("href", "https://example.org/guia");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");

    await userEvent.click(screen.getByRole("button", { name: t("corpus.content.download") }));
    await waitFor(() => expect(mocks.downloadCorpusFile).toHaveBeenCalledWith("with-file"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
