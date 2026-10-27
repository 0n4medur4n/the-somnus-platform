import type { FunnelState } from "@somnus/api-contracts";
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";
import { EvaluationDetail } from "./EvaluationDetail.js";

const edge = vi.hoisted(() => ({
  getFunnel: vi.fn(),
  getOwnFunnelSessions: vi.fn(),
  funnelReportUrl: (id: string, locale: string) =>
    `/v1/funnel/sessions/${id}/report.pdf?locale=${locale}`,
}));
vi.mock("../lib/edge.js", () => ({ edge }));

const RESULT = {
  stoppedBy: null,
  alerts: [],
  mainAction: "TERAPIA",
  associatedActions: [],
  testToConsider: null,
  texts: [{ template: "T_INSOMNIO", text: "Nos ha contado que se despierta varias veces." }],
  instruments: [],
  instrumentsNote: null,
  contentVersion: "2.0",
  rulesVersion: "2.0",
  panel: null,
};

function finished(overrides: Partial<FunnelState> = {}): FunnelState {
  return {
    sessionId: "f-1",
    status: "finished",
    step: null,
    result: RESULT,
    history: [],
    owned: true,
    ...overrides,
  };
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/app/evaluations/:sessionId" element={<EvaluationDetail />} />
    </Routes>,
    { route: "/app/evaluations/f-1" },
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage("es");
  edge.getOwnFunnelSessions.mockResolvedValue({
    sessions: [
      {
        sessionId: "f-1",
        status: "finished",
        mainAction: "TERAPIA",
        headline: [],
        createdAt: "2026-10-28T10:00:00+00:00",
      },
    ],
  });
});

describe("EvaluationDetail", () => {
  it("shows the saved result with its PDF, and when it was saved", async () => {
    edge.getFunnel.mockResolvedValue(finished());
    renderDetail();
    expect(await screen.findByText(RESULT.texts[0]?.text ?? "")).toBeVisible();
    expect(screen.getByRole("link", { name: i18n.t("funnel.result.download") })).toBeVisible();
    expect(await screen.findByText(/Guardada el/)).toBeVisible();
    expect(edge.getFunnel).toHaveBeenCalledWith("f-1", false);
  });

  it("says so when the interview is not finished", async () => {
    edge.getFunnel.mockResolvedValue(finished({ status: "open", result: null }));
    renderDetail();
    expect(await screen.findByText(i18n.t("resultPage.unfinished"))).toBeVisible();
  });

  it("says it could not load when the interview is not the person's own", async () => {
    edge.getFunnel.mockRejectedValue(new Error("not found"));
    renderDetail();
    expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("resultPage.error"));
  });
});
