import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupFingerprint, parseLegalText } from "../components/LegalDocument.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const edge = vi.hoisted(() => ({
  getConsentRecords: vi.fn(),
  withdrawConsent: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge }));

const { MyConsents } = await import("./MyConsents.js");

const t = (key: string) => i18n.t(key);

function record(purposeKey: string, extra: Record<string, unknown> = {}) {
  return {
    receiptId: `r-${purposeKey}`,
    purposeKey,
    source: "app",
    consentedAt: "2026-10-15T10:00:00.000Z",
    document: {
      id: `v-${purposeKey}`,
      purposeKey,
      title: purposeKey,
      version: 2,
      locale: "es",
      content: `## Apartado\nTexto de ${purposeKey}.`,
      contentSha256: "e".repeat(64),
      effectiveAt: "2026-10-15T09:00:00.000Z",
    },
    ...extra,
  };
}

describe("MyConsents (the signed copies)", () => {
  beforeEach(() => {
    edge.getConsentRecords.mockReset().mockResolvedValue({
      receipts: [
        record("health_data_processing"),
        record("terms_acceptance"),
        record("marketing", { withdrawnAt: "2026-10-15T11:00:00.000Z" }),
      ],
    });
    edge.withdrawConsent.mockReset().mockResolvedValue(undefined);
  });

  it("lists each consent with its status, and shows the exact accepted text on demand", async () => {
    renderWithProviders(<MyConsents />);
    const health = (await screen.findByText(t("legal.title.health_data_processing"))).closest("li");
    if (!health) throw new Error("no card");
    expect(within(health).getByText(t("consents.status.active"))).toBeInTheDocument();

    await userEvent.click(within(health).getByRole("button", { name: t("consents.view") }));
    expect(within(health).getByText("Texto de health_data_processing.")).toBeInTheDocument();
    expect(within(health).getByTestId("document-fingerprint")).toHaveTextContent("eeee eeee");

    const marketing = screen.getByText(t("legal.title.marketing")).closest("li");
    expect(
      within(marketing as HTMLElement).getByText(t("consents.status.withdrawn")),
    ).toBeVisible();
  });

  it("withdraws a consent only after confirming", async () => {
    renderWithProviders(<MyConsents />);
    const health = (await screen.findByText(t("legal.title.health_data_processing"))).closest("li");
    if (!health) throw new Error("no card");
    await userEvent.click(within(health).getByRole("button", { name: t("consents.withdraw") }));
    expect(edge.withdrawConsent).not.toHaveBeenCalled();
    expect(within(health).getByText(t("consents.confirmHealth"))).toBeInTheDocument();
    await userEvent.click(
      within(health).getByRole("button", { name: t("consents.confirmWithdraw") }),
    );
    await waitFor(() =>
      expect(edge.withdrawConsent).toHaveBeenCalledWith("r-health_data_processing"),
    );
  });

  it("offers no withdrawal for the terms: leaving them is deleting the account", async () => {
    renderWithProviders(<MyConsents />);
    const terms = (await screen.findByText(t("legal.title.terms_acceptance"))).closest("li");
    expect(
      within(terms as HTMLElement).queryByRole("button", { name: t("consents.withdraw") }),
    ).toBeNull();
  });
});

describe("legal text rendering", () => {
  it("turns the stored plain text into headings, paragraphs and lists, never HTML", () => {
    expect(parseLegalText("## Título\nUn párrafo.\n\n- uno\n- dos\n\n<b>no</b>")).toEqual([
      { kind: "heading", text: "Título" },
      { kind: "paragraph", text: "Un párrafo." },
      { kind: "list", items: ["uno", "dos"] },
      { kind: "paragraph", text: "<b>no</b>" },
    ]);
  });

  it("groups the fingerprint in fours so it can be compared by eye", () => {
    expect(groupFingerprint("abcdef0123456789")).toBe("abcd ef01 2345 6789");
  });
});
