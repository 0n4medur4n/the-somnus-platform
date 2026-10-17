import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const { getPersonReport } = vi.hoisted(() => ({ getPersonReport: vi.fn() }));
vi.mock("../lib/edge.js", () => ({ edge: { getPersonReport } }));

const { ResultView } = await import("./ResultView.js");
const t = (key: string) => i18n.t(key);

const CONTENT = {
  locale: "es" as const,
  workflowVersion: "1.0",
  contentVersion: "1.0",
  modules: [
    {
      id: "BRE" as const,
      name: "Respiración durante el sueño",
      entry: ["ronquido", "pausas presenciadas"],
      minimumQuestions: ["¿Le han observado pausas?"],
      output: "Has comunicado un patrón respiratorio que conviene valorar.",
    },
  ],
  safetyLevels: [
    { id: "L3" as const, name: "Consulta programada", action: "Prepara una consulta programada." },
  ],
  safetyPrompts: [
    {
      signalId: "witnessed_apneas" as const,
      context: "general" as const,
      question: "¿Le han visto pausas al respirar?",
      questionByRole: {},
    },
  ],
  limitsText: ["No és un diagnòstic."],
  blockedClaims: ["Morpheo substitueix una consulta."],
  // The real artifact forbidden phrases: none may reach the screen (§20 exit).
  outputContract: {
    patientParent: ["Resumen."],
    professional: ["Resumen."],
    forbiddenPhrases: [
      "Tienes [diagnóstico].",
      "No tienes [enfermedad].",
      "El riesgo bajo descarta...",
      "Debes iniciar/suspender/cambiar [medicamento].",
      "Morpheo sustituye una consulta.",
    ],
  },
};

const RESULT_L3 = {
  role: "adult" as const,
  level: "L3" as const,
  stop: false,
  privacyBlock: false,
  routes: ["BRE" as const],
  triggeredRules: [] as string[],
  workflowVersion: "1.0",
  contentVersion: "1.0",
};

const REPORT = {
  summary: "Nos has contado que roncas. Conviene una consulta programada.",
  whatToDo: ["Pide una consulta con tu médico de familia."],
  patterns: [{ name: "Respiración durante el sueño", why: "Has descrito ronquido." }],
  recommendations: ["Pide a alguien que observe si haces pausas al dormir."],
  prepare: ["Apunta desde cuándo roncas."],
};

describe("ResultView (§14b output contract)", () => {
  beforeEach(() => getPersonReport.mockReset());

  it("without an AI report, shows the protocol's wording and the L3 'with the information available' framing", () => {
    renderWithProviders(
      <ResultView result={RESULT_L3} content={CONTENT} complaints={["ronquido"]} />,
    );
    expect(screen.getByText("Consulta programada")).toBeInTheDocument();
    expect(screen.getByText("Prepara una consulta programada.")).toBeInTheDocument();
    expect(getPersonReport).not.toHaveBeenCalled();
    // L3/L4 must carry the framing.
    expect(screen.getByText(/con la información disponible/i)).toBeInTheDocument();
    // The activating fact is shown under the pattern.
    expect(screen.getByText(/ronquido/)).toBeInTheDocument();
  });

  it("never lets a forbidden phrase reach the screen", () => {
    const { container } = renderWithProviders(
      <ResultView result={RESULT_L3} content={CONTENT} complaints={["ronquido"]} />,
    );
    const rendered = container.textContent ?? "";
    for (const phrase of CONTENT.outputContract.forbiddenPhrases) {
      expect(rendered).not.toContain(phrase);
      const literal = phrase
        .replace(/\[.*?\]/g, "")
        .replace(/\.\.\.$/, "")
        .trim();
      if (literal.length > 0) expect(rendered.includes(literal)).toBe(false);
    }
  });

  it("shows the person's report for the assessment", async () => {
    getPersonReport.mockResolvedValue({
      assessmentId: "s1",
      locale: "es",
      generated: true,
      narrative: REPORT,
    });
    renderWithProviders(
      <ResultView result={RESULT_L3} content={CONTENT} complaints={[]} sessionId="s1" />,
    );
    expect(await screen.findByText(REPORT.summary)).toBeInTheDocument();
    expect(getPersonReport).toHaveBeenCalledWith("s1", "es");
    expect(screen.getByText(REPORT.whatToDo[0] ?? "")).toBeInTheDocument();
    expect(screen.getByText(REPORT.recommendations[0] ?? "")).toBeInTheDocument();
    expect(screen.getByText(REPORT.prepare[0] ?? "")).toBeInTheDocument();
    // The protocol's raw instruction is not shown next to the AI text.
    expect(screen.queryByText("Prepara una consulta programada.")).not.toBeInTheDocument();
  });

  it("says it is preparing the report while it is written", async () => {
    let finish: (value: unknown) => void = () => {};
    getPersonReport.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderWithProviders(
      <ResultView result={RESULT_L3} content={CONTENT} complaints={[]} sessionId="s1" />,
    );
    expect(await screen.findByText(t("assessment.result.preparing"))).toBeInTheDocument();
    finish({ assessmentId: "s1", locale: "es", generated: false });
    expect(await screen.findByText("Prepara una consulta programada.")).toBeInTheDocument();
  });

  it("an emergency shows the rule's own words at once and never asks for an AI report", () => {
    const emergency = {
      ...CONTENT,
      safetyLevels: [{ id: "L0" as const, name: "Emergencia actual", action: "Interrumpir." }],
      safetyRules: [
        { id: "SAFE-001", level: "L0" as const, message: "Busca atención de emergencia ahora." },
      ],
    };
    renderWithProviders(
      <ResultView
        result={{ ...RESULT_L3, level: "L0", stop: true, triggeredRules: ["SAFE-001"] }}
        content={emergency}
        complaints={[]}
        sessionId="s1"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Busca atención de emergencia ahora.");
    // The system instruction is never shown to the person.
    expect(screen.queryByText("Interrumpir.")).not.toBeInTheDocument();
    expect(getPersonReport).not.toHaveBeenCalled();
  });
});
