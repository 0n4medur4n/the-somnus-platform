import type { MeResponse } from "@somnus/api-contracts";
import { useQueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../auth/AuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const edge = vi.hoisted(() => ({
  getAssessmentContent: vi.fn(),
  createAssessment: vi.fn(),
  submitAssessmentAnswer: vi.fn(),
  getAssessmentSummary: vi.fn(),
  requestAssessmentClaimToken: vi.fn(),
  claimAssessment: vi.fn(),
  getOwnAssessments: vi.fn(),
  getAssessmentSnapshot: vi.fn(),
  photoUrl: vi.fn((version: string) => `/v1/me/photo?v=${version}`),
}));
vi.mock("../lib/edge.js", () => ({ edge }));
vi.mock("../config/env.js", () => ({
  env: { VITE_ADMIN_CONSOLE_URL: "https://console.example.com" },
}));

const { Assessment } = await import("./Assessment.js");
const { MorpheoHome, OWN_ASSESSMENTS_QUERY } = await import("./MorpheoHome.js");
const { AssessmentDetail } = await import("./AssessmentDetail.js");
const { MorpheoLayout } = await import("../layouts/MorpheoLayout.js");

const CONTENT = {
  locale: "es",
  workflowVersion: "1.0",
  contentVersion: "1.1",
  modules: [
    {
      id: "INS",
      name: "Dificultad para dormir",
      entry: ["despertares"],
      minimumQuestions: ["¿Desde cuándo?"],
      output: "Has comunicado un patrón de dificultad para dormir.",
    },
  ],
  safetyLevels: [
    { id: "L4", name: "Información y observación", action: "Educación general y observación." },
    { id: "L3", name: "Consulta programada", action: "Pide cita con tu médico." },
  ],
  safetyPrompts: [],
  limitsText: ["No es un diagnóstico."],
  blockedClaims: [],
  outputContract: { patientParent: ["Resumen."], professional: ["Resumen."], forbiddenPhrases: [] },
};

const L4_RESULT = {
  role: "parent",
  level: "L4",
  stop: false,
  privacyBlock: false,
  routes: ["INS"],
  triggeredRules: [] as string[],
  workflowVersion: "1.0",
  contentVersion: "1.1",
};

const HISTORY = {
  assessments: [
    {
      sessionId: "s-new",
      role: "adult",
      level: "L3",
      stop: false,
      createdAt: "2026-10-05T09:30:00+00:00",
    },
    {
      sessionId: "s-old",
      role: "adult",
      level: "L4",
      stop: false,
      createdAt: "2026-03-14T18:00:00+00:00",
    },
  ],
};

function authFor(
  account: Partial<MeResponse["account"]> = {},
  profile: Partial<NonNullable<MeResponse["individualProfile"]>> = {},
): AuthContextValue {
  return {
    state: {
      status: "authenticated",
      me: {
        user: { id: "u", email: "ada@example.com", locale: "es", status: "active" },
        individualProfile: { firstName: "Ada", lastName: "Lovelace", ...profile },
        professionalProfile: null,
        account: { registrationRole: "adult", internalRoles: [], organizations: [], ...account },
      },
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
  };
}

const t = (key: string) => i18n.t(key);

beforeEach(() => {
  for (const fn of Object.values(edge)) fn.mockClear();
  edge.getAssessmentContent.mockResolvedValue(CONTENT);
  edge.createAssessment.mockResolvedValue({ allowed: true, sessionId: "s1", reason: null });
  edge.submitAssessmentAnswer.mockResolvedValue(L4_RESULT);
  edge.getAssessmentSummary.mockResolvedValue(L4_RESULT);
  edge.requestAssessmentClaimToken.mockResolvedValue({ token: "tok" });
  edge.claimAssessment.mockResolvedValue({ success: true, snapshotId: "snap", reason: null });
  edge.getOwnAssessments.mockResolvedValue(HISTORY);
  edge.getAssessmentSnapshot.mockResolvedValue({
    snapshotId: "snap",
    sessionId: "s-old",
    result: { ...L4_RESULT, role: "adult" },
    workflowVersion: "1.0",
    contentVersion: "1.1",
  });
});

describe("the questionnaire inside a Morpheo user's space", () => {
  it("starts on the branch they registered for, without the professional path", async () => {
    const auth = authFor({ registrationRole: "parent" });
    if (auth.state.status !== "authenticated") throw new Error("unreachable");
    renderWithProviders(<Assessment embedded me={auth.state.me} />, { auth });

    expect(await screen.findByLabelText(t("assessment.role.parent"))).toBeChecked();
    expect(screen.queryByLabelText(t("assessment.role.professional"))).toBeNull();
  });

  it("knows an adult's age from their date of birth", async () => {
    const auth = authFor({}, { dateOfBirth: "1990-01-01" });
    if (auth.state.status !== "authenticated") throw new Error("unreachable");
    renderWithProviders(<Assessment embedded me={auth.state.me} />, { auth });

    const age = await screen.findByLabelText(t("assessment.role.ageAdult"));
    expect(Number((age as HTMLInputElement).value)).toBeGreaterThanOrEqual(35);
  });

  it("saves the result to the account on its own, once, and offers the way to their space", async () => {
    const auth = authFor({ registrationRole: "parent" });
    if (auth.state.status !== "authenticated") throw new Error("unreachable");
    renderWithProviders(<Assessment embedded me={auth.state.me} />, { auth });

    await screen.findByLabelText(t("assessment.role.parent"));
    await userEvent.type(screen.getByLabelText(t("assessment.role.ageMinor")), "7");
    await userEvent.click(screen.getByLabelText(t("assessment.role.guardianship")));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));
    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));
    await userEvent.click(
      await screen.findByRole("button", { name: t("assessment.actions.next") }),
    );
    await userEvent.click(await screen.findByLabelText("despertares"));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.seeResult") }));

    expect(await screen.findByText(t("assessment.result.autoSaved"))).toBeInTheDocument();
    expect(edge.requestAssessmentClaimToken).toHaveBeenCalledWith("s1");
    expect(edge.claimAssessment).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: t("assessment.actions.goToSpace") })).toHaveAttribute(
      "href",
      "/app",
    );
    // Embedded: the space's layout owns the page's main landmark.
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("says so, and lets them retry, when saving fails", async () => {
    edge.claimAssessment.mockResolvedValueOnce({
      success: false,
      snapshotId: null,
      reason: "already_claimed_or_expired",
    });
    const auth = authFor();
    if (auth.state.status !== "authenticated") throw new Error("unreachable");
    renderWithProviders(<Assessment embedded me={auth.state.me} />, { auth });

    await userEvent.type(await screen.findByLabelText(t("assessment.role.ageAdult")), "40");
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));
    await userEvent.click(screen.getByLabelText(t("assessment.consent.label")));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.next") }));
    await userEvent.click(
      await screen.findByRole("button", { name: t("assessment.actions.next") }),
    );
    await userEvent.click(await screen.findByLabelText("despertares"));
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.seeResult") }));

    expect(await screen.findByText(t("assessment.result.saveFailed"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("assessment.actions.retrySave") }));
    expect(await screen.findByText(t("assessment.result.autoSaved"))).toBeInTheDocument();
  });
});

describe("MorpheoHome (the user's own space)", () => {
  function renderHome(auth: AuthContextValue) {
    renderWithProviders(
      <Routes>
        <Route path="/app" element={<MorpheoHome />} />
        <Route path="/assessment" element={<p>questionnaire</p>} />
      </Routes>,
      { auth, route: "/app" },
    );
  }

  it("after the first saved result, opens the space instead of bouncing back on a stale empty list", async () => {
    // Registration lands on /app with no assessments (cached as empty) and is
    // sent to the questionnaire; the result is saved and the list invalidated;
    // back on /app the cached empty list must not redirect again.
    edge.getOwnAssessments.mockResolvedValueOnce({ assessments: [] }).mockResolvedValue(HISTORY);

    function SaveAndReturn() {
      const queryClient = useQueryClient();
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={async () => {
            await queryClient.invalidateQueries({ queryKey: OWN_ASSESSMENTS_QUERY });
            await navigate("/app");
          }}
        >
          saved, go to my space
        </button>
      );
    }

    renderWithProviders(
      <Routes>
        <Route path="/app" element={<MorpheoHome />} />
        <Route path="/assessment" element={<SaveAndReturn />} />
      </Routes>,
      { auth: authFor(), route: "/app" },
    );

    await userEvent.click(await screen.findByRole("button", { name: "saved, go to my space" }));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(t("space.title"));
  });

  it("sends someone with no saved assessment to the questionnaire", async () => {
    edge.getOwnAssessments.mockResolvedValue({ assessments: [] });
    renderHome(authFor());
    expect(await screen.findByText("questionnaire")).toBeInTheDocument();
  });

  it("shows who they are, their first and latest assessment, and every saved result", async () => {
    renderHome(authFor());

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(t("space.title"));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();

    const first = screen.getByText(t("space.stats.first")).parentElement;
    const last = screen.getByText(t("space.stats.last")).parentElement;
    expect(within(first as HTMLElement).getByText(/2026/)).toHaveTextContent(/marzo/);
    expect(within(last as HTMLElement).getByText(/2026/)).toHaveTextContent(/octubre/);
    expect(
      within(screen.getByText(t("space.stats.count")).parentElement as HTMLElement).getByText("2"),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: t("space.newAssessment.start") })).toHaveAttribute(
      "href",
      "/assessment",
    );
    const history = screen.getByRole("heading", { name: t("space.history.title") })
      .parentElement as HTMLElement;
    const views = within(history).getAllByRole("link");
    expect(views.map((link) => link.getAttribute("href"))).toEqual([
      "/app/assessments/s-new",
      "/app/assessments/s-old",
    ]);
    // The level name is the approved wording from the content endpoint.
    expect(await within(history).findByText("Consulta programada")).toBeInTheDocument();
  });

  it("nudges them to complete their profile until photo, birth date and phone are in", async () => {
    renderHome(authFor());
    expect(await screen.findByText(t("space.completeProfile"))).toBeInTheDocument();
  });

  it("stops nudging once the profile is complete, and shows the photo", async () => {
    renderHome(
      authFor(
        {},
        {
          photoUpdatedAt: "2026-10-05T10:00:00.000Z",
          dateOfBirth: "1990-01-01",
          phone: "600123456",
        },
      ),
    );
    expect(await screen.findByRole("img", { name: t("profile.photoAlt") })).toHaveAttribute(
      "src",
      "/v1/me/photo?v=2026-10-05T10:00:00.000Z",
    );
    expect(screen.queryByText(t("space.completeProfile"))).toBeNull();
  });
});

describe("AssessmentDetail (one saved result)", () => {
  it("renders the frozen result with its date", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/app/assessments/:sessionId" element={<AssessmentDetail />} />
      </Routes>,
      { auth: authFor(), route: "/app/assessments/s-old" },
    );

    expect(await screen.findByText("Información y observación")).toBeInTheDocument();
    expect(edge.getAssessmentSnapshot).toHaveBeenCalledWith("s-old");
    await waitFor(() => expect(screen.getByText(/14 de marzo de 2026/)).toBeInTheDocument());
  });
});

describe("MorpheoLayout", () => {
  const navLinks = () =>
    within(screen.getByRole("navigation", { name: t("common.menu") }))
      .getAllByRole("link")
      .map((link) => link.textContent ?? "");

  it("offers only their own space: home, a new assessment, their profile", () => {
    renderWithProviders(<MorpheoLayout>content</MorpheoLayout>, { auth: authFor() });
    expect(navLinks()).toEqual([t("nav.mySpace"), t("nav.newAssessment"), t("nav.myProfile")]);
  });

  it("adds the admin console for platform staff, in a new tab", () => {
    renderWithProviders(<MorpheoLayout>content</MorpheoLayout>, {
      auth: authFor({ internalRoles: ["platform_super_admin"] }),
    });
    const link = screen.getByRole("link", { name: new RegExp(t("nav.console")) });
    expect(link).toHaveAttribute("href", "https://console.example.com");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
