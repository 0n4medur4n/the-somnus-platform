import {
  type AdminCapability,
  type AdminMeResponse,
  INTERNAL_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey,
} from "@somnus/api-contracts";
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContextValue } from "../auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { contentReviewQueue } = vi.hoisted(() => ({ contentReviewQueue: vi.fn() }));
vi.mock("../lib/edge.js", () => ({
  edge: {
    contentReviewQueue,
    adminMe: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue({ users: [], truncated: false }),
    deletionRequests: vi.fn().mockResolvedValue([]),
    organizations: vi.fn().mockResolvedValue([]),
    verificationQueue: vi.fn().mockResolvedValue([]),
    statistics: vi.fn().mockResolvedValue(null),
    auditQuery: vi.fn().mockResolvedValue({ rows: [] }),
    searchCorpus: vi.fn().mockResolvedValue({ documents: [], currentVersion: 0 }),
    corpusSources: vi.fn().mockResolvedValue({ sources: [] }),
  },
}));
vi.mock("../auth/firebase-auth.js", () => ({
  sendLoginLink: vi.fn(),
  isEmailLink: () => false,
  storedEmail: () => null,
  completeEmailLinkSignIn: vi.fn(),
  firebaseSignOut: vi.fn(),
}));

const { Gate } = await import("../App.js");
const { ContentReviewScreen } = await import("./ContentReviewScreen.js");

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars ?? {});

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const CITATION = "Kapur VK. Diagnostic Testing for Adult OSA.";
const DOC_TITLE = "Higiene del sueño en adultos";

/** The §A2.2 rows, transcribed here rather than imported, so this can disagree. */
const CAPABILITIES_BY_ROLE: Record<string, AdminCapability[]> = {
  support_agent: ["admin_users_read", "admin_statistics_read", "admin_consent_read"],
  professional_verifier: ["admin_users_read", "admin_verification_queue"],
  clinical_governance_reviewer: [
    "admin_content_review",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_break_glass",
  ],
  platform_admin: [
    "admin_users_read",
    "admin_account_status_write",
    "admin_deletion_requests_process",
    "admin_verification_queue",
    "admin_organizations_manage",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_consent_read",
    "admin_break_glass",
    "admin_system_health",
  ],
  platform_super_admin: [
    "admin_users_read",
    "admin_roles_assign",
    "admin_break_glass",
    "admin_content_review",
    "admin_corpus_manage",
  ],
};

function authorized(roleKeys: RoleKey[], capabilities: AdminCapability[]): AdminAuthContextValue {
  const me: AdminMeResponse = {
    user: { id: ACTOR, email: "admin@somnus.test", locale: "es", status: "active" },
    roleKeys,
    capabilities,
  };
  return { state: { status: "authorized", me }, refresh: async () => {}, logout: vi.fn() };
}

function item(provenance: unknown) {
  return {
    itemId: "item-1",
    reportId: "report-1",
    promptTemplateVersion: "rewrite_v1",
    modelId: "gpt-5.6",
    inputHash: "a".repeat(64),
    outputHash: "b".repeat(64),
    deterministicText: "El resultado estructurado aprobado.",
    candidateText: "Tus respuestas sugieren revisar tus horarios de descanso.",
    status: "pending_review",
    reviewerId: null,
    decidedAt: null,
    reason: null,
    createdAt: "2026-09-16T12:00:00.000Z",
    provenance,
  };
}

const PROVENANCE = {
  corpusVersion: 7,
  contentVersion: "1.2",
  citations: [
    {
      sourceId: "SRC-02",
      citation: CITATION,
      url: "https://example.org/src-02",
      resolvedBy: "rule",
    },
  ],
  documents: [
    {
      documentId: "doc-1",
      title: DOC_TITLE,
      citation: "The Somnus (2026).",
      locale: "es",
      corpusVersionAdded: 3,
      retiredSince: false,
    },
  ],
};

beforeEach(() => {
  contentReviewQueue.mockReset();
  contentReviewQueue.mockResolvedValue({ items: [] });
});

/**
 * Corpus provenance in the review queue (Addendum B §B5 Checkpoint 16.5).
 *
 * The reviewer's question is whether the candidate says what the approved prose
 * says. This panel answers the second half of it — what the approved prose was
 * itself grounded in — so these tests assert the rendered data a reviewer would
 * actually read, not merely that a field arrived.
 */
describe("corpus provenance in the review queue", () => {
  it("shows the corpus version, the Index A citation and the Index B titles", async () => {
    contentReviewQueue.mockResolvedValue({ items: [item(PROVENANCE)] });
    renderWithProviders(<ContentReviewScreen />);

    const panel = await screen.findByTestId("provenance-item-1");
    expect(within(panel).getByTestId("corpus-version-item-1").textContent).toBe("7");
    expect(within(panel).getByText("1.2")).toBeTruthy();
    // The citation by its text, and the document by its title -- not by id.
    expect(within(panel).getByText(CITATION)).toBeTruthy();
    expect(within(panel).getByText(new RegExp(DOC_TITLE))).toBeTruthy();
    expect(
      within(panel).getByText(t("contentReview.provenanceAddedIn", { version: 3 }), {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it("keeps the citation and the supporting material in separate lists", async () => {
    contentReviewQueue.mockResolvedValue({ items: [item(PROVENANCE)] });
    renderWithProviders(<ContentReviewScreen />);

    const panel = await screen.findByTestId("provenance-item-1");
    const citation = within(panel).getByText(CITATION).closest("li") as HTMLElement;
    const document_ = within(panel).getByText(new RegExp(DOC_TITLE)).closest("li") as HTMLElement;

    // §B3.1's separation, carried into the review UI: a citation is evidence a
    // rule named, supporting material is background an admin published.
    expect(citation.getAttribute("data-source-id")).toBe("SRC-02");
    expect(citation.getAttribute("data-document-id")).toBeNull();
    expect(document_.getAttribute("data-document-id")).toBe("doc-1");
    expect(document_.getAttribute("data-source-id")).toBeNull();
  });

  it("flags a document retired since the report was generated", async () => {
    contentReviewQueue.mockResolvedValue({
      items: [
        item({
          ...PROVENANCE,
          documents: [{ ...PROVENANCE.documents[0], retiredSince: true }],
        }),
      ],
    });
    renderWithProviders(<ContentReviewScreen />);

    // Still described -- it is what grounded this report -- and marked as no
    // longer being what would ground a new one.
    expect(await screen.findByText(new RegExp(DOC_TITLE))).toBeTruthy();
    expect(screen.getByTestId("retired-doc-1").textContent).toContain(
      t("contentReview.provenanceRetired"),
    );
  });

  it("shows the citation and an empty supporting list when the corpus was empty", async () => {
    // Every environment today (16.4): nothing published, corpus version 0.
    contentReviewQueue.mockResolvedValue({
      items: [item({ ...PROVENANCE, corpusVersion: 0, documents: [] })],
    });
    renderWithProviders(<ContentReviewScreen />);

    const panel = await screen.findByTestId("provenance-item-1");
    expect(within(panel).getByTestId("corpus-version-item-1").textContent).toBe("0");
    // The half that matters is there...
    expect(within(panel).getByText(CITATION)).toBeTruthy();
    // ...and the other half says so plainly rather than erroring.
    expect(within(panel).getByText(t("contentReview.provenanceNoDocuments"))).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("distinguishes a report with no record from one with an empty one", async () => {
    contentReviewQueue.mockResolvedValue({ items: [item(null)] });
    renderWithProviders(<ContentReviewScreen />);

    expect(await screen.findByTestId("provenance-missing-item-1")).toBeTruthy();
    expect(screen.queryByTestId("provenance-item-1")).toBeNull();
    // Absent is not an error: the reviewer can still do the job.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the queue at all when an item predates the field entirely", async () => {
    const { provenance: _omitted, ...withoutField } = item(null);
    contentReviewQueue.mockResolvedValue({ items: [withoutField] });
    renderWithProviders(<ContentReviewScreen />);

    expect(await screen.findByText(t("contentReview.candidate"))).toBeTruthy();
    expect(screen.getByTestId("provenance-missing-item-1")).toBeTruthy();
  });
});

/**
 * The role gate, parametrized over EVERY role rather than the two §A4 names.
 *
 * 16.5 adds no route: the provenance rides on the queue the 15.3 capability
 * already gates. So the thing to prove is that the gate still holds with the new
 * data on it — a role that cannot reach the queue cannot reach the provenance,
 * and the section is structurally absent rather than empty.
 */
describe("who can see corpus provenance at all", () => {
  const HOLDERS: RoleKey[] = ["clinical_governance_reviewer", "platform_super_admin"];
  const INTERNAL = ROLE_KEYS.filter((key) => INTERNAL_ROLE_KEYS.has(key));
  const EXTERNAL = ROLE_KEYS.filter((key) => !INTERNAL_ROLE_KEYS.has(key));

  it.each(HOLDERS)("%s reaches the queue section", (role) => {
    renderWithProviders(<Gate />, {
      auth: authorized([role], CAPABILITIES_BY_ROLE[role] ?? []),
    });

    const nav = screen.getByRole("navigation");
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toContain(
      t("nav.contentReview"),
    );
  });

  it.each(INTERNAL.filter((role) => !HOLDERS.includes(role)))(
    "%s: no nav entry, no section, no provenance",
    (role) => {
      renderWithProviders(<Gate />, {
        auth: authorized([role], CAPABILITIES_BY_ROLE[role] ?? []),
      });

      const nav = screen.getByRole("navigation");
      expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
        t("nav.contentReview"),
      );
      expect(screen.queryByRole("heading", { name: t("contentReview.title") })).toBeNull();
      expect(screen.queryByText(t("contentReview.provenanceTitle"))).toBeNull();
      expect(screen.queryByTestId("provenance-item-1")).toBeNull();
    },
  );

  it.each(EXTERNAL)("%s: denial screen, so no console surface at all", (role) => {
    renderWithProviders(<Gate />, {
      auth: { ...authorized([role], []), state: { status: "denied" } },
    });

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(t("contentReview.provenanceTitle"))).toBeNull();
  });
});
