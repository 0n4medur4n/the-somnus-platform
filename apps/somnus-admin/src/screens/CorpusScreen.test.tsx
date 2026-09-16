import type { CorpusDocument } from "@somnus/api-contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const mocks = vi.hoisted(() => ({
  searchCorpus: vi.fn(),
  corpusDocument: vi.fn(),
  createCorpusDocument: vi.fn(),
  editCorpusDocument: vi.fn(),
  publishCorpusDocument: vi.fn(),
  retireCorpusDocument: vi.fn(),
  corpusSources: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: mocks }));

const { CorpusScreen } = await import("./CorpusScreen.js");
const { CorpusSourcesScreen } = await import("./CorpusSourcesScreen.js");

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars ?? {});

const ACTOR = "018f0000-0000-7000-8000-000000000abc";

function document_(overrides: Partial<CorpusDocument> = {}): CorpusDocument {
  return {
    id: "doc-1",
    title: "Higiene del sueño en adultos",
    citation: "The Somnus (2026). Guía interna.",
    sourceType: "guideline",
    locale: "es",
    status: "draft",
    rightsStatus: "own_document",
    rightsEvidence: {},
    addedBy: ACTOR,
    corpusVersionAdded: null,
    corpusVersionRetired: null,
    retiredReason: null,
    scopes: [{ scopeType: "module", scopeKey: "INS" }],
    chunkCount: 2,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.searchCorpus.mockResolvedValue({ documents: [], currentVersion: 0 });
  mocks.corpusSources.mockResolvedValue({ sources: [] });
});

/**
 * The corpus console (Addendum B §B3 / Checkpoint 16.3).
 *
 * The API-boundary guarantees are proven in the report service's integration
 * suite and the edge-api gate test. What is proven here is what the screen
 * offers: the three transitions §B3 allows, the §B4 warnings, and — the point of
 * the whole section — that no control anywhere offers to delete anything.
 */
describe("corpus console", () => {
  it("offers edit and publish on a draft, retire on a published document, nothing on a retired one", async () => {
    mocks.searchCorpus.mockResolvedValue({
      documents: [
        document_({ id: "d-draft", title: "Documento en borrador", status: "draft" }),
        document_({
          id: "d-live",
          title: "Documento vigente",
          status: "published",
          corpusVersionAdded: 3,
        }),
        document_({
          id: "d-old",
          title: "Documento antiguo",
          status: "retired",
          corpusVersionAdded: 1,
          corpusVersionRetired: 4,
          retiredReason: "Sustituida por la edici\u00f3n de 2027.",
        }),
      ],
      currentVersion: 4,
    });

    renderWithProviders(<CorpusScreen />);
    await screen.findByText("Documento en borrador");

    const itemFor = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
    const draft = itemFor("Documento en borrador");
    const live = itemFor("Documento vigente");
    const retired = itemFor("Documento antiguo");

    expect(within(draft).getByRole("button", { name: t("corpus.edit") })).toBeTruthy();
    expect(within(draft).getByRole("button", { name: t("corpus.publish") })).toBeTruthy();
    expect(within(draft).queryByRole("button", { name: t("corpus.retire") })).toBe(null);

    expect(within(live).getByRole("button", { name: t("corpus.retire") })).toBeTruthy();
    expect(within(live).queryByRole("button", { name: t("corpus.publish") })).toBe(null);

    // A retired document is history. History is read, not edited.
    expect(within(retired).queryAllByRole("button")).toEqual([]);
    expect(
      within(retired).getByText(
        t("corpus.retiredReason", { reason: "Sustituida por la edici\u00f3n de 2027." }),
      ),
    ).toBeTruthy();
  });

  it("takes a document from draft to published to retired through the real calls", async () => {
    const user = userEvent.setup();
    // One screen, four loads: empty, then the draft, then published, then
    // retired -- the document moving through §B3's three states as the console
    // drives it.
    mocks.searchCorpus
      .mockResolvedValueOnce({ documents: [], currentVersion: 0 })
      .mockResolvedValueOnce({ documents: [document_()], currentVersion: 0 })
      .mockResolvedValueOnce({
        documents: [document_({ status: "published", corpusVersionAdded: 1 })],
        currentVersion: 1,
      })
      .mockResolvedValue({
        documents: [
          document_({ status: "retired", corpusVersionAdded: 1, corpusVersionRetired: 2 }),
        ],
        currentVersion: 2,
      });
    mocks.createCorpusDocument.mockResolvedValue(document_());
    mocks.publishCorpusDocument.mockResolvedValue({
      documentId: "doc-1",
      status: "published",
      corpusVersion: 1,
    });
    mocks.retireCorpusDocument.mockResolvedValue({
      documentId: "doc-1",
      status: "retired",
      corpusVersion: 2,
    });

    renderWithProviders(<CorpusScreen />);
    await screen.findByText(t("corpus.empty"));

    await user.type(screen.getByLabelText(t("corpus.titleLabel")), "Higiene del sue\u00f1o");
    await user.type(screen.getByLabelText(t("corpus.citationLabel")), "The Somnus (2026).");
    await user.click(screen.getByRole("button", { name: t("corpus.create") }));

    await waitFor(() => expect(mocks.createCorpusDocument).toHaveBeenCalledTimes(1));
    expect(mocks.createCorpusDocument.mock.calls[0]?.[0]).toMatchObject({
      title: "Higiene del sue\u00f1o",
      scopes: [{ scopeType: "module", scopeKey: "" }],
    });

    // The draft is listed; publish it with the changelog §B3 requires.
    const draft = (await screen.findByText("Higiene del sue\u00f1o en adultos")).closest(
      "li",
    ) as HTMLElement;
    await user.type(
      within(draft).getByLabelText(t("corpus.changelogLabel")),
      "Alta de la gu\u00eda.",
    );
    await user.click(within(draft).getByRole("button", { name: t("corpus.publish") }));

    await waitFor(() => expect(mocks.publishCorpusDocument).toHaveBeenCalledTimes(1));
    expect(mocks.publishCorpusDocument.mock.calls[0]?.[1]).toEqual({
      changelog: "Alta de la gu\u00eda.",
    });

    // Published: retire is now the only transition offered, and it needs a
    // reason as well as a changelog.
    // Found by the control it now offers: the status word also appears in the
    // status filter above, so the button is the unambiguous handle.
    const published = (await screen.findByRole("button", { name: t("corpus.retire") })).closest(
      "li",
    ) as HTMLElement;
    await user.type(within(published).getByLabelText(t("corpus.retireReasonLabel")), "Obsoleta.");
    await user.type(within(published).getByLabelText(t("corpus.changelogLabel")), "Retirada.");
    await user.click(within(published).getByRole("button", { name: t("corpus.retire") }));

    await waitFor(() => expect(mocks.retireCorpusDocument).toHaveBeenCalledTimes(1));
    expect(mocks.retireCorpusDocument.mock.calls[0]?.[1]).toEqual({
      reason: "Obsoleta.",
      changelog: "Retirada.",
    });

    // And it ends as history: retired, with no control left on it.
    await waitFor(() => {
      const done = screen.getByText("Higiene del sueño en adultos").closest("li") as HTMLElement;
      expect(within(done).queryAllByRole("button")).toEqual([]);
    });
  });

  it("offers no way to delete anything, in any status", async () => {
    mocks.searchCorpus.mockResolvedValue({
      documents: [
        document_({ id: "d1", status: "draft" }),
        document_({ id: "d2", status: "published", corpusVersionAdded: 1 }),
        document_({ id: "d3", status: "retired", corpusVersionAdded: 1, corpusVersionRetired: 2 }),
      ],
      currentVersion: 2,
    });

    renderWithProviders(<CorpusScreen />);
    await screen.findAllByText("Higiene del sueño en adultos");

    // Not "the delete button is disabled": there is no such control, in either
    // language, and the edge client it would have to call does not exist.
    for (const word of [/borrar/i, /eliminar/i, /delete/i, /remove document/i]) {
      expect(screen.queryAllByRole("button", { name: word })).toEqual([]);
    }
    expect("deleteCorpusDocument" in mocks).toBe(false);
  });

  it("warns in plain language about the two rights statuses that cost something outside", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CorpusScreen />);
    await screen.findByText(t("corpus.empty"));

    const rights = screen.getByLabelText(t("corpus.rightsLabel"));

    await user.selectOptions(rights, "own_document");
    expect(screen.queryByTestId("corpus-rights-warning")).toBe(null);

    await user.selectOptions(rights, "licensed");
    expect(screen.getByTestId("corpus-rights-warning").textContent).toBe(
      t("corpus.rightsWarning.licensed"),
    );
    // §B4 requires licence + holder for this status, and the form asks for both.
    expect(screen.getByLabelText(t("corpus.evidence.licence"))).toBeTruthy();
    expect(screen.getByLabelText(t("corpus.evidence.holder"))).toBeTruthy();

    await user.selectOptions(rights, "citation_only");
    expect(screen.getByTestId("corpus-rights-warning").textContent).toBe(
      t("corpus.rightsWarning.citation_only"),
    );

    await user.selectOptions(rights, "open_access");
    expect(screen.queryByTestId("corpus-rights-warning")).toBe(null);
    expect(screen.getByLabelText(t("corpus.evidence.licence"))).toBeTruthy();
    expect(screen.getByLabelText(t("corpus.evidence.url"))).toBeTruthy();
  });

  it("does not gate publishing on its own reading of the rights rules", async () => {
    // The form asks for evidence; it does not decide. A draft whose declared
    // status has no evidence filled in can still be sent, and the report
    // service's §B4 gate is what refuses it -- one gate, in one place.
    const user = userEvent.setup();
    mocks.searchCorpus.mockResolvedValue({
      documents: [document_({ rightsStatus: "licensed", rightsEvidence: {} })],
      currentVersion: 0,
    });
    mocks.publishCorpusDocument.mockRejectedValue(new Error("refused"));

    renderWithProviders(<CorpusScreen />);
    await screen.findAllByText("Higiene del sueño en adultos");

    await user.type(
      screen.getAllByLabelText(t("corpus.changelogLabel"))[0] as HTMLElement,
      "Alta.",
    );
    await user.click(
      screen.getAllByRole("button", { name: t("corpus.publish") })[0] as HTMLElement,
    );

    await waitFor(() => expect(mocks.publishCorpusDocument).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

/** §B3.1: enrich a clinical source without touching what the artifact owns. */
describe("clinical source enrichment", () => {
  const view = {
    artifact: {
      id: "SRC-05",
      citation: "AASM Clinical Practice Guideline (2017)",
      url: "https://example.org/aasm-2017",
      use: "Umbrales de latencia de sueño",
      citedByRules: ["SAFE-006"],
    },
    contentVersion: "1.1",
    enrichments: [],
  };

  it("shows the artifact's fields as text, never as inputs", async () => {
    mocks.corpusSources.mockResolvedValue({ sources: [view] });
    renderWithProviders(<CorpusSourcesScreen />);
    await screen.findByText("SRC-05");

    const artifact = screen.getByTestId("artifact-SRC-05");
    expect(within(artifact).getByText("AASM Clinical Practice Guideline (2017)")).toBeTruthy();
    expect(within(artifact).getByText("Umbrales de latencia de sueño")).toBeTruthy();
    expect(within(artifact).getByText("SAFE-006")).toBeTruthy();

    // No input, no textarea, no select anywhere in the artifact block: these
    // fields belong to morpheo_workflows_v1.json, and the contract carries no
    // request that could write them even if this rendered one.
    expect(artifact.querySelectorAll("input, textarea, select").length).toBe(0);
    expect(screen.getByText(t("corpusSources.readOnlyNote"))).toBeTruthy();
    expect(screen.getByText(t("corpusSources.artifactNote"))).toBeTruthy();
  });

  it("creates an enrichment scoped to that source and to nothing else", async () => {
    const user = userEvent.setup();
    mocks.corpusSources.mockResolvedValue({ sources: [view] });
    mocks.createCorpusDocument.mockResolvedValue(
      document_({ scopes: [{ scopeType: "clinical_source", scopeKey: "SRC-05" }] }),
    );

    renderWithProviders(<CorpusSourcesScreen />);
    await screen.findByText("SRC-05");

    await user.click(screen.getByRole("button", { name: t("corpusSources.addEnrichment") }));
    await user.type(
      screen.getByLabelText(t("corpus.titleLabel")),
      "Cómo explicamos SRC-05 a familias",
    );
    await user.click(screen.getByRole("button", { name: t("corpus.create") }));

    await waitFor(() => expect(mocks.createCorpusDocument).toHaveBeenCalledTimes(1));
    const body = mocks.createCorpusDocument.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body["scopes"]).toEqual([{ scopeType: "clinical_source", scopeKey: "SRC-05" }]);
    // Nothing the artifact owns is in the request, because no such field exists
    // in the shape the console can send.
    for (const field of ["id", "use", "citedByRules", "url"]) {
      expect(field in body).toBe(false);
    }
  });
});
