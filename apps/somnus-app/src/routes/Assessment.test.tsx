import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const {
  getAssessmentContent,
  createAssessment,
  submitAssessmentAnswer,
  getAssessmentSummary,
  getLegalDocuments,
  getConsentStatus,
  recordConsent,
} = vi.hoisted(() => ({
  getAssessmentContent: vi.fn(),
  createAssessment: vi.fn(),
  submitAssessmentAnswer: vi.fn(),
  getAssessmentSummary: vi.fn(),
  getLegalDocuments: vi.fn(),
  getConsentStatus: vi.fn(),
  recordConsent: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({
  edge: {
    getAssessmentContent,
    createAssessment,
    submitAssessmentAnswer,
    getAssessmentSummary,
    getLegalDocuments,
    getConsentStatus,
    recordConsent,
  },
}));

const HEALTH_DOCUMENT = {
  id: "019fe7a0-0003-7000-8000-000000000003",
  purposeKey: "health_data_processing",
  title: "Health Data Processing Policy",
  version: 2,
  locale: "es",
  content: "## Qué datos\nTus respuestas a las preguntas.",
  contentSha256: "c".repeat(64),
  effectiveAt: "2026-10-15T09:00:00.000Z",
};

const { Assessment } = await import("./Assessment.js");

const CONTENT = {
  locale: "es",
  workflowVersion: "1.0",
  contentVersion: "1.1",
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
    { id: "L1", name: "Valoración urgente", action: "No conduzcas y busca valoración hoy." },
  ],
  safetyPrompts: [
    {
      signalId: "sleepiness_near_miss",
      context: "general",
      question: "¿Casi un accidente por sueño?",
      questionByRole: {},
    },
  ],
  limitsText: ["No es un diagnóstico."],
  blockedClaims: ["Morpheo sustituye una consulta."],
  outputContract: {
    patientParent: ["Resumen."],
    professional: ["Resumen."],
    forbiddenPhrases: ["Tienes [diagnóstico]."],
  },
};

const BASE_SUMMARY = {
  role: "adult",
  privacyBlock: false,
  triggeredRules: [] as string[],
  workflowVersion: "1.0",
  contentVersion: "1.1",
};
const L4_SUMMARY = { ...BASE_SUMMARY, level: "L4", stop: false, routes: ["INS"] };
const EMERGENCY_SUMMARY = { ...BASE_SUMMARY, level: "L1", stop: true, routes: [] as string[] };

const t = (key: string) => i18n.t(key);
const next = () => screen.getByRole("button", { name: t("assessment.actions.next") });

describe("Assessment flow (build plan §20 Checkpoint 10.3, safety-first)", () => {
  beforeEach(() => {
    getAssessmentContent.mockReset().mockResolvedValue(CONTENT);
    createAssessment
      .mockReset()
      .mockResolvedValue({ allowed: true, sessionId: "s1", reason: null });
    submitAssessmentAnswer.mockReset().mockResolvedValue(L4_SUMMARY);
    getAssessmentSummary.mockReset().mockResolvedValue(L4_SUMMARY);
    getLegalDocuments.mockReset().mockResolvedValue({ documents: [HEALTH_DOCUMENT] });
    getConsentStatus.mockReset();
    recordConsent.mockReset();
  });

  it("shows the health-data document in full, with its version and fingerprint, before consent", async () => {
    renderWithProviders(<Assessment />, { route: "/assessment" });
    await userEvent.click(await screen.findByLabelText(t("assessment.role.adult")));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageAdult")), "35");
    await userEvent.click(next());

    expect(await screen.findByText("Tus respuestas a las preguntas.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Qué datos" })).toBeInTheDocument();
    expect(screen.getByTestId("document-fingerprint")).toHaveTextContent("cccc cccc");
    // Nothing is consented until the person ticks it.
    expect(next()).toBeDisabled();
    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    expect(next()).toBeEnabled();
    // Anonymous: there is no account to record a receipt in yet.
    await userEvent.click(next());
    await waitFor(() => expect(createAssessment).toHaveBeenCalled());
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("will not take consent when the document cannot be loaded", async () => {
    getLegalDocuments.mockRejectedValue(new Error("down"));
    renderWithProviders(<Assessment />, { route: "/assessment" });
    await userEvent.click(await screen.findByLabelText(t("assessment.role.adult")));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageAdult")), "35");
    await userEvent.click(next());

    expect(await screen.findByText(t("legal.loadError"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("assessment.consent.label"))).toBeNull();
    expect(next()).toBeDisabled();
  });

  it("adult path: role -> consent -> safety -> concern -> the L4 result", async () => {
    renderWithProviders(<Assessment />, { route: "/assessment" });

    await userEvent.click(await screen.findByLabelText(t("assessment.role.adult")));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageAdult")), "35");
    await userEvent.click(next());

    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(next());

    // Safety-first, one question at a time (no emergency): answering the last
    // question moves the flow on by itself.
    expect(await screen.findByText("¿Casi un accidente por sueño?")).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t("assessment.safety.questionOf", { current: 1, total: 1 })),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("assessment.safety.no") }));

    await userEvent.click(await screen.findByLabelText("despertares"));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.seeResult") }));

    expect(await screen.findByText(t("assessment.result.title"))).toBeInTheDocument();
    expect(screen.getByText("Información y observación")).toBeInTheDocument();
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

  it("an emergency safety answer stops the flow before the concern step", async () => {
    getAssessmentSummary.mockResolvedValue(EMERGENCY_SUMMARY);
    renderWithProviders(<Assessment />, { route: "/assessment" });

    await userEvent.click(await screen.findByLabelText(t("assessment.role.adult")));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageAdult")), "35");
    await userEvent.click(next());
    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(next());

    await userEvent.click(await screen.findByRole("button", { name: t("assessment.safety.yes") }));

    // Straight to the result — the concern step is skipped.
    expect(await screen.findByText(t("assessment.result.title"))).toBeInTheDocument();
    expect(screen.getByText("Valoración urgente")).toBeInTheDocument();
    expect(submitAssessmentAnswer).toHaveBeenCalledWith("s1", {
      kind: "signal",
      name: "sleepiness_near_miss",
      value: "true",
    });
    expect(submitAssessmentAnswer).not.toHaveBeenCalledWith("s1", {
      kind: "complaint",
      name: expect.anything(),
    });
  });

  it("asks each audience in its own voice: the parent reads it about their child", async () => {
    getAssessmentContent.mockResolvedValue({
      ...CONTENT,
      safetyPrompts: [
        {
          signalId: "cyanosis",
          context: "general",
          question: "¿Notas que tus labios están azulados?",
          questionByRole: {
            adult: "¿Notas que tus labios están azulados?",
            parent: "¿Observas que los labios de tu hijo o hija están azulados?",
            professional: "¿Observas que los labios de la persona a la que valoras están azulados?",
          },
        },
      ],
    });
    renderWithProviders(<Assessment />, { route: "/assessment" });

    await userEvent.click(await screen.findByLabelText(t("assessment.role.parent")));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageMinor")), "8");
    await userEvent.click(screen.getByLabelText(t("assessment.role.guardianship")));
    await userEvent.click(next());
    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(next());

    expect(
      await screen.findByText("¿Observas que los labios de tu hijo o hija están azulados?"),
    ).toBeInTheDocument();
    expect(screen.queryByText("¿Notas que tus labios están azulados?")).not.toBeInTheDocument();
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
    await userEvent.click(next());

    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(next());

    expect(
      await screen.findByText(t("assessment.result.blocked.privacy_block")),
    ).toBeInTheDocument();
    expect(submitAssessmentAnswer).not.toHaveBeenCalled();
  });
});
