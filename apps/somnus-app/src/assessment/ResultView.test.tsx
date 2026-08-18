import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/utils.js";
import { ResultView } from "./ResultView.js";

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

describe("ResultView (§14b output contract)", () => {
  it("renders the approved wording and shows the L3 'with the information available' framing", () => {
    renderWithProviders(
      <ResultView result={RESULT_L3} content={CONTENT} complaints={["ronquido"]} />,
    );
    expect(screen.getByText("Consulta programada")).toBeInTheDocument();
    expect(screen.getByText("Prepara una consulta programada.")).toBeInTheDocument();
    expect(
      screen.getByText("Has comunicado un patrón respiratorio que conviene valorar."),
    ).toBeInTheDocument();
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
});
