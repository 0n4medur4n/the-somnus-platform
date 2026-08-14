import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const { getAssessmentContent, createAssessment, submitAssessmentAnswer, getAssessmentSummary } =
  vi.hoisted(() => ({
    getAssessmentContent: vi.fn(),
    createAssessment: vi.fn(),
    submitAssessmentAnswer: vi.fn(),
    getAssessmentSummary: vi.fn(),
  }));
vi.mock("../lib/edge.js", () => ({
  edge: { getAssessmentContent, createAssessment, submitAssessmentAnswer, getAssessmentSummary },
}));

const { Assessment } = await import("./Assessment.js");

const CONTENT = {
  locale: "es",
  workflowVersion: "1.0",
  contentVersion: "1.0",
  modules: [
    {
      id: "INS",
      name: "Dificultad para dormir",
      entry: ["despertares", "dificultad para conciliar"],
      minimumQuestions: ["¿Desde cuándo?"],
      output: "Has comunicado un patrón de dificultad para dormir.",
    },
  ],
  safetyLevels: [
    { id: "L4", name: "Información y observación", action: "Educación general y observación." },
  ],
  outputContract: {
    patientParent: ["Resumen."],
    professional: ["Resumen."],
    forbiddenPhrases: ["Tienes [diagnóstico]."],
  },
};

const SUMMARY = {
  role: "adult",
  level: "L4",
  stop: false,
  privacyBlock: false,
  routes: ["INS"],
  triggeredRules: [],
  workflowVersion: "1.0",
  contentVersion: "1.0",
};

const t = (key: string) => i18n.t(key);

describe("Assessment flow (build plan §20 Checkpoint 10.3)", () => {
  beforeEach(() => {
    getAssessmentContent.mockReset().mockResolvedValue(CONTENT);
    createAssessment.mockReset();
    submitAssessmentAnswer.mockReset().mockResolvedValue(SUMMARY);
    getAssessmentSummary.mockReset().mockResolvedValue(SUMMARY);
  });

  it("adult INS path: role -> consent -> concern -> the L4 result", async () => {
    createAssessment.mockResolvedValue({ allowed: true, sessionId: "s1", reason: null });
    renderWithProviders(<Assessment />, { route: "/assessment" });

    await userEvent.click(await screen.findByLabelText(t("assessment.role.adult")));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageAdult")), "35");
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));

    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));

    await userEvent.click(screen.getByLabelText("despertares"));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.seeResult") }));

    expect(await screen.findByText(t("assessment.result.title"))).toBeInTheDocument();
    expect(screen.getByText("Información y observación")).toBeInTheDocument();
    expect(
      screen.getByText("Has comunicado un patrón de dificultad para dormir."),
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(createAssessment).toHaveBeenCalledWith(
        expect.objectContaining({ role: "adult", consentGiven: true, ageYears: 35 }),
      ),
    );
    expect(submitAssessmentAnswer).toHaveBeenCalledWith("s1", {
      kind: "complaint",
      name: "despertares",
    });
  });

  it("professional with identifiable data is blocked (privacy)", async () => {
    createAssessment.mockResolvedValue({
      allowed: false,
      sessionId: null,
      reason: "privacy_block",
    });
    renderWithProviders(<Assessment />, { route: "/assessment" });

    await userEvent.click(await screen.findByLabelText(t("assessment.role.professional")));
    await userEvent.click(screen.getByLabelText(t("assessment.role.professionalConfirm")));
    await userEvent.click(screen.getByLabelText(t("assessment.role.identifiable")));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));

    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));

    await userEvent.click(screen.getByLabelText("despertares"));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.seeResult") }));

    expect(
      await screen.findByText(t("assessment.result.blocked.privacy_block")),
    ).toBeInTheDocument();
    expect(submitAssessmentAnswer).not.toHaveBeenCalled();
  });
});
