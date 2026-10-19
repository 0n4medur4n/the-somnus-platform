import type { FunnelState, FunnelStep, MeResponse } from "@somnus/api-contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";

const edgeMock = vi.hoisted(() => ({
  getLegalDocuments: vi.fn(),
  getConsentStatus: vi.fn(),
  recordConsent: vi.fn(),
  startFunnel: vi.fn(),
  getFunnel: vi.fn(),
  answerFunnel: vi.fn(),
  backFunnel: vi.fn(),
  rewindFunnel: vi.fn(),
  funnelReportUrl: vi.fn(() => "http://edge/report.pdf"),
}));
vi.mock("../../lib/edge.js", () => ({ edge: edgeMock }));

const { FunnelAssessment } = await import("./FunnelAssessment.js");

const es = i18n.getFixedT("es");

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

function step(overrides: Partial<FunnelStep> = {}): FunnelStep {
  return {
    key: "AGE",
    questionId: "AGE",
    kind: "ask",
    type: "number",
    text: "¿Qué edad tiene?",
    note: null,
    options: [],
    fields: [],
    noneOption: false,
    unit: "años",
    units: [],
    allowAbsence: true,
    instrument: null,
    phase: "start",
    answeredCount: 0,
    extraction: null,
    panel: null,
    ...overrides,
  };
}

/** The confirmation screen after Q01: two items the AI took from the narrative. */
function confirmation(): FunnelStep {
  return step({
    key: "Q01#confirmacion",
    questionId: "IA_CONFIRMAR",
    kind: "confirm_extraction",
    type: "confirm_extraction",
    text: "Por lo que nos ha contado, entendemos:",
    note: "¿Es correcto?",
    unit: null,
    answeredCount: 3,
    extraction: {
      source: "Q01",
      items: [
        {
          id: "Q03",
          question: "¿Desde cuándo le ocurre?",
          answer: "6 meses",
          evidence: "Desde hace unos seis meses",
          editable: true,
          type: "duration",
          options: [],
          fields: [],
          noneOption: false,
          unit: null,
          units: ["dias", "semanas", "meses", "años"],
        },
        {
          id: "Q14.epilepsia",
          question: "¿Hay alguna molestia, enfermedad o tratamiento que influya en su descanso?",
          answer: "Tiene epilepsia",
          evidence: "tengo epilepsia",
          editable: false,
          type: "info",
          options: [],
          fields: [],
          noneOption: false,
          unit: null,
          units: [],
        },
      ],
    },
  });
}

function state(overrides: Partial<FunnelState> = {}): FunnelState {
  return {
    sessionId: "f-1",
    status: "open",
    step: step(),
    result: null,
    history: [],
    owned: false,
    ...overrides,
  };
}

const RESULT = {
  stoppedBy: null,
  alerts: [],
  mainAction: "TERAPIA",
  associatedActions: [],
  testToConsider: null,
  texts: [
    { template: "T_INSOMNIO", text: "Nos ha contado que se despierta varias veces por la noche." },
  ],
  instruments: [],
  instrumentsNote: null,
  contentVersion: "2.0",
  rulesVersion: "2.0",
  panel: null,
};

async function startInterview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByLabelText(es("assessment.consent.label")));
  await user.click(screen.getByRole("button", { name: es("funnel.actions.start") }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  await i18n.changeLanguage("es");
  edgeMock.getLegalDocuments.mockResolvedValue({ documents: [HEALTH_DOCUMENT] });
  edgeMock.getConsentStatus.mockResolvedValue({ purposes: [] });
  edgeMock.startFunnel.mockResolvedValue(state());
});

describe("FunnelAssessment", () => {
  it("asks for the health-data consent, then shows the engine's first step", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FunnelAssessment />);
    expect(screen.getByRole("button", { name: es("funnel.actions.start") })).toBeDisabled();
    await startInterview(user);
    expect(edgeMock.startFunnel).toHaveBeenCalledWith(false);
    expect(await screen.findByRole("heading", { name: "¿Qué edad tiene?" })).toBeVisible();
  });

  it("sends the answer to the step it was served, and shows the next one", async () => {
    const user = userEvent.setup();
    edgeMock.answerFunnel.mockResolvedValue(
      state({
        step: step({
          key: "S1@start",
          questionId: "S1",
          type: "yes_no",
          text: "¿S1?",
          unit: null,
          answeredCount: 1,
        }),
      }),
    );
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    await user.type(await screen.findByLabelText("años"), "52");
    await user.click(screen.getByRole("button", { name: es("funnel.actions.continue") }));
    expect(edgeMock.answerFunnel).toHaveBeenCalledWith("f-1", { key: "AGE", value: 52 }, false);
    expect(await screen.findByRole("heading", { name: "¿S1?" })).toBeVisible();
  });

  it("always offers «No lo sé» and «Prefiero no responder»", async () => {
    const user = userEvent.setup();
    edgeMock.answerFunnel.mockResolvedValue(state());
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    await user.click(await screen.findByRole("button", { name: es("funnel.actions.unknown") }));
    expect(edgeMock.answerFunnel).toHaveBeenCalledWith(
      "f-1",
      { key: "AGE", absence: "no_lo_se" },
      false,
    );
  });

  it("keeps free text with a phone number from being sent", async () => {
    const user = userEvent.setup();
    edgeMock.startFunnel.mockResolvedValue(
      state({
        step: step({
          key: "Q01",
          questionId: "Q01",
          type: "free_text",
          text: "Cuénteme",
          unit: null,
        }),
      }),
    );
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    await user.type(
      await screen.findByLabelText(es("funnel.text.label")),
      "llamadme al 612 345 678",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(es("funnel.text.identifying"));
    expect(screen.getByRole("button", { name: es("funnel.actions.continue") })).toBeDisabled();
  });

  it("lets the person correct an answer from the Z1 summary", async () => {
    const user = userEvent.setup();
    edgeMock.startFunnel.mockResolvedValue(
      state({
        step: step({
          key: "Z1",
          questionId: "Z1",
          type: "yes_no",
          text: "Esto es lo que he entendido: …",
          unit: null,
          answeredCount: 3,
          phase: "closing",
        }),
        history: [
          { key: "AGE", question: "¿Qué edad tiene?", answer: "52 años" },
          {
            key: "Q05",
            question: "En una semana habitual, ¿cuántas noches le ocurre?",
            answer: "4 noches por semana",
          },
        ],
      }),
    );
    edgeMock.rewindFunnel.mockResolvedValue(
      state({
        step: step({
          key: "Q05",
          questionId: "Q05",
          text: "En una semana habitual, ¿cuántas noches le ocurre?",
          unit: "noches por semana",
        }),
      }),
    );
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    await user.click(await screen.findByRole("button", { name: es("funnel.actions.fix") }));
    expect(screen.getByRole("heading", { name: es("funnel.correct.title") })).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: `${es("funnel.actions.change")}: En una semana habitual, ¿cuántas noches le ocurre?`,
      }),
    );
    expect(edgeMock.rewindFunnel).toHaveBeenCalledWith("f-1", "Q05", false);
  });

  it("shows the final text as it comes, with the PDF only for an owned interview", async () => {
    const user = userEvent.setup();
    edgeMock.startFunnel.mockResolvedValue(
      state({ status: "finished", step: null, result: RESULT, owned: true }),
    );
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    expect(await screen.findByText(RESULT.texts[0]?.text ?? "")).toBeVisible();
    expect(screen.getByRole("link", { name: es("funnel.result.download") })).toBeVisible();
    expect(screen.queryByTestId("team-panel")).toBeNull();
  });

  it("asks for the team panel only for staff, and shows it when it arrives", async () => {
    const user = userEvent.setup();
    const staff = {
      user: { id: "u", email: "s@example.com", locale: "es", status: "active" },
      individualProfile: null,
      professionalProfile: null,
      account: {
        registrationRole: null,
        internalRoles: ["platform_super_admin"],
        organizations: [],
      },
    } as unknown as MeResponse;
    edgeMock.startFunnel.mockResolvedValue(
      state({
        step: step({
          panel: {
            reason: null,
            source: "AGE",
            branchesOpened: [],
            rulesFired: [],
            mainAction: null,
            phraseIds: [],
            ai: [
              {
                source: "Q01",
                status: "ok",
                model: "gpt-6-luna",
                promptVersion: "extraccion-v2.0-1",
                risk: { S1: "no", S4: "no", S2: "dudoso" },
                discarded: 1,
                items: [
                  {
                    id: "Q03",
                    question: "¿Desde cuándo le ocurre?",
                    answer: "6 meses",
                    evidence: "Desde hace unos seis meses",
                    decision: "confirmado",
                    corrected: null,
                  },
                ],
              },
            ],
            instruments: [
              {
                code: "ISI",
                name: null,
                status: "pending_file",
                total: null,
                band: null,
                placement: "v0.2 p. 5, I6",
              },
            ],
          },
        }),
      }),
    );
    renderWithProviders(<FunnelAssessment me={staff} />);
    await startInterview(user);
    expect(edgeMock.startFunnel).toHaveBeenCalledWith(true);
    const panel = await screen.findByTestId("team-panel");
    await user.click(screen.getByText(es("funnel.panel.title")));
    expect(panel).toHaveTextContent("pendiente: archivo oficial de Jesús");
    // What the AI proposed, the words it came from, and what the person decided.
    const ai = screen.getByTestId("team-panel-ai");
    expect(ai).toHaveTextContent("S2 dudoso");
    expect(ai).toHaveTextContent("Q03: 6 meses — «Desde hace unos seis meses» → confirmado");
  });

  it("resumes the interview in progress after a reload", async () => {
    window.sessionStorage.setItem("somnus.funnel.session", "f-9");
    edgeMock.getFunnel.mockResolvedValue(state({ sessionId: "f-9" }));
    renderWithProviders(<FunnelAssessment />);
    expect(await screen.findByRole("heading", { name: "¿Qué edad tiene?" })).toBeVisible();
    await waitFor(() => expect(edgeMock.getFunnel).toHaveBeenCalledWith("f-9", false));
  });
});

describe("FunnelAssessment · what the AI took from the narrative", () => {
  it("shows each item with the person's words and counts nothing until each one is decided", async () => {
    const user = userEvent.setup();
    edgeMock.startFunnel.mockResolvedValue(state({ step: confirmation() }));
    edgeMock.answerFunnel.mockResolvedValue(state());
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    expect(
      await screen.findByRole("heading", { name: "Por lo que nos ha contado, entendemos:" }),
    ).toBeVisible();
    expect(screen.getByText("6 meses")).toBeVisible();
    expect(
      screen.getByText(es("funnel.extraction.evidence", { words: "Desde hace unos seis meses" })),
    ).toBeVisible();
    expect(screen.getAllByText("¿Es correcto?")).toHaveLength(2);
    const next = screen.getByRole("button", { name: es("funnel.actions.continue") });
    expect(next).toBeDisabled();
    const [first, second] = screen.getAllByRole("group");
    await user.click(
      within(first as HTMLElement).getByLabelText(es("funnel.extraction.decisions.confirmado")),
    );
    expect(next).toBeDisabled();
    // A Q14 flag can be kept or removed, not edited.
    expect(
      within(second as HTMLElement).queryByLabelText(es("funnel.extraction.decisions.corregido")),
    ).toBeNull();
    await user.click(
      within(second as HTMLElement).getByLabelText(es("funnel.extraction.decisions.quitado")),
    );
    expect(screen.getByText(es("funnel.extraction.removedHint"))).toBeVisible();
    await user.click(next);
    expect(edgeMock.answerFunnel).toHaveBeenCalledWith(
      "f-1",
      {
        key: "Q01#confirmacion",
        decisions: [
          { id: "Q03", decision: "confirmado" },
          { id: "Q14.epilepsia", decision: "quitado" },
        ],
      },
      false,
    );
  });

  it("corrects an item with its own question's answer form", async () => {
    const user = userEvent.setup();
    edgeMock.startFunnel.mockResolvedValue(state({ step: confirmation() }));
    edgeMock.answerFunnel.mockResolvedValue(state());
    renderWithProviders(<FunnelAssessment />);
    await startInterview(user);
    const [first, second] = await screen.findAllByRole("group");
    await user.click(
      within(first as HTMLElement).getByLabelText(es("funnel.extraction.decisions.corregido")),
    );
    const next = screen.getByRole("button", { name: es("funnel.actions.continue") });
    await user.type(screen.getByLabelText(es("funnel.duration.amount")), "2");
    await user.selectOptions(screen.getByLabelText(es("funnel.duration.unit")), "años");
    // The correction form's own button records the value; the screen's button sends.
    await user.click(screen.getByRole("button", { name: es("funnel.extraction.saveCorrection") }));
    expect(screen.getByText(es("funnel.extraction.corrected"), { exact: false })).toBeVisible();
    await user.click(
      within(second as HTMLElement).getByLabelText(es("funnel.extraction.decisions.confirmado")),
    );
    await user.click(next);
    expect(edgeMock.answerFunnel).toHaveBeenCalledWith(
      "f-1",
      {
        key: "Q01#confirmacion",
        decisions: [
          { id: "Q03", decision: "corregido", value: { value: 2, unit: "años" } },
          { id: "Q14.epilepsia", decision: "confirmado" },
        ],
      },
      false,
    );
  });
});
