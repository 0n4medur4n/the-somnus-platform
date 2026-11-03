import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  type AdminMeResponse,
  FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH,
  type FunnelCase,
  type FunnelCaseStats,
  type RoleKey,
} from "@somnus/api-contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContextValue } from "../auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { morpheoCaseOpen, morpheoStatistics } = vi.hoisted(() => ({
  morpheoCaseOpen: vi.fn(),
  morpheoStatistics: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({
  edge: {
    morpheoCaseOpen,
    morpheoStatistics,
    searchUsers: vi.fn().mockResolvedValue({ users: [], truncated: false }),
    deletionRequests: vi.fn().mockResolvedValue([]),
    organizations: vi.fn().mockResolvedValue([]),
    verificationQueue: vi.fn().mockResolvedValue([]),
    contentReviewQueue: vi.fn().mockResolvedValue({ items: [] }),
    statistics: vi.fn().mockResolvedValue(null),
    auditQuery: vi.fn().mockResolvedValue({ rows: [] }),
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
const { StatisticsScreen } = await import("./StatisticsScreen.js");

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars ?? {});

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const CODE = "SOM-7K3F-Q9XA";
const WHY = "Reclamación formal recibida esta mañana, expediente 12.";

function authorized(roleKeys: RoleKey[], capabilities: AdminCapability[]): AdminAuthContextValue {
  const me: AdminMeResponse = {
    user: { id: ACTOR, email: "admin@somnus.test", locale: "es", status: "active" },
    roleKeys,
    capabilities,
  };
  return { state: { status: "authorized", me }, refresh: async () => {}, logout: vi.fn() };
}

const CASE: FunnelCase = {
  caseCode: CODE,
  status: "finished",
  startedAt: "2026-11-01T09:00:00+00:00",
  closedAt: "2026-11-01T09:12:00+00:00",
  contentVersion: "2.2",
  rulesVersion: "2.2",
  interviewDeleted: true,
  records: [
    {
      recordedAt: "2026-11-01T09:12:00+00:00",
      status: "finished",
      reconstructed: false,
      contentVersion: "2.2",
      rulesVersion: "2.2",
      history: [
        { key: "AGE", question: "¿Qué edad tiene?", answer: "45 años" },
        { key: "Q05", question: "¿Cuántas noches por semana?", answer: "5" },
      ],
      result: {
        stoppedBy: null,
        alerts: [],
        mainAction: "TERAPIA",
        associatedActions: [],
        testToConsider: null,
        texts: [{ template: "T_INSOMNIO", text: "Le proponemos una terapia para el insomnio." }],
        instruments: [],
        instrumentsNote: null,
        contentVersion: "2.2",
        rulesVersion: "2.2",
        panel: null,
      },
    },
  ],
  changes: [
    {
      changedAt: "2026-11-01T09:05:00+00:00",
      withdrawn: [{ key: "Q05", question: "¿Cuántas noches por semana?", answer: "2" }],
    },
  ],
  accesses: [
    {
      accessedAt: "2026-11-03T10:00:00+00:00",
      actorId: ACTOR,
      category: "legal",
      justification: WHY,
    },
  ],
};

describe("who is offered Morpheo cases", () => {
  it("only the holder of admin_morpheo_case_read, not a break-glass holder", () => {
    renderWithProviders(<Gate />, {
      auth: authorized(["platform_admin"], ["admin_break_glass", "admin_statistics_read"]),
    });
    const nav = screen.getByRole("navigation");
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      t("nav.morpheoCases"),
    );
  });

  it("holding every capability except it is still not enough", () => {
    const everythingElse = ADMIN_CAPABILITIES.filter((c) => c !== "admin_morpheo_case_read");
    renderWithProviders(<Gate />, {
      auth: authorized(["platform_super_admin"], [...everythingElse]),
    });
    const nav = screen.getByRole("navigation");
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      t("nav.morpheoCases"),
    );
  });
});

describe("opening a case", () => {
  beforeEach(() => {
    morpheoCaseOpen.mockReset();
    morpheoCaseOpen.mockResolvedValue(CASE);
  });

  async function visit() {
    renderWithProviders(<Gate />, {
      auth: authorized(["platform_super_admin"], ["admin_morpheo_case_read"]),
    });
    await userEvent.click(screen.getByRole("button", { name: t("nav.morpheoCases") }));
  }

  async function fill(justification: string) {
    await userEvent.type(screen.getByLabelText(t("morpheoCases.codeLabel")), ` ${CODE} `);
    await userEvent.selectOptions(screen.getByLabelText(t("breakGlass.categoryLabel")), "legal");
    await userEvent.type(screen.getByLabelText(t("breakGlass.justificationLabel")), justification);
  }

  it("does nothing until a code, a category and a real reason exist", async () => {
    await visit();
    const open = screen.getByRole("button", { name: t("morpheoCases.open") });
    expect(open).toBeDisabled();

    await fill("x".repeat(FUNNEL_CASE_JUSTIFICATION_MIN_LENGTH - 3));
    expect(open).toBeDisabled();
    expect(screen.getByText(t("breakGlass.charactersShort", { count: 3 }))).toBeInTheDocument();
    await userEvent.click(open);
    expect(morpheoCaseOpen).not.toHaveBeenCalled();
  });

  it("sends the code, the category and the reason together, and shows the case", async () => {
    await visit();
    await fill(WHY);
    await userEvent.click(screen.getByRole("button", { name: t("morpheoCases.open") }));

    expect(morpheoCaseOpen).toHaveBeenCalledWith({
      caseCode: CODE,
      category: "legal",
      justification: WHY,
    });
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    // What was asked and answered, what was shown, and what was taken back.
    expect(screen.getByText("45 años")).toBeInTheDocument();
    expect(screen.getByText("Le proponemos una terapia para el insomnio.")).toBeInTheDocument();
    expect(screen.getByText(t("outcome.template.T_INSOMNIO"))).toBeInTheDocument();
    const changes = screen.getByRole("article", { name: t("morpheoCases.changesTitle") });
    expect(within(changes).getByText("2")).toBeInTheDocument();
    // The case says it is linked to nobody, and who opened it, with their words.
    expect(screen.getByText(t("morpheoCases.interviewDeleted"))).toBeInTheDocument();
    const accesses = screen.getByRole("article", { name: t("morpheoCases.accessesTitle") });
    expect(within(accesses).getByText(`«${WHY}»`)).toBeInTheDocument();
  });

  it("closing forgets the case and the reason: the next opening needs its own", async () => {
    await visit();
    await fill(WHY);
    await userEvent.click(screen.getByRole("button", { name: t("morpheoCases.open") }));
    await userEvent.click(await screen.findByRole("button", { name: t("breakGlass.close") }));

    expect(screen.queryByText(CODE)).toBeNull();
    expect(screen.getByLabelText(t("breakGlass.justificationLabel"))).toHaveValue("");
    expect(screen.getByRole("button", { name: t("morpheoCases.open") })).toBeDisabled();
  });

  it("a record today's contract cannot read is shown raw, never dropped", async () => {
    const old = { ...CASE.records[0], result: { legacyField: "texto antiguo" } };
    morpheoCaseOpen.mockResolvedValue({ ...CASE, records: [old] });
    await visit();
    await fill(WHY);
    await userEvent.click(screen.getByRole("button", { name: t("morpheoCases.open") }));

    expect(await screen.findByText(/texto antiguo/)).toBeInTheDocument();
  });

  it("a reconstructed record says so", async () => {
    const rebuilt = { ...CASE.records[0], reconstructed: true };
    morpheoCaseOpen.mockResolvedValue({ ...CASE, records: [rebuilt] });
    await visit();
    await fill(WHY);
    await userEvent.click(screen.getByRole("button", { name: t("morpheoCases.open") }));

    expect(await screen.findByText(t("morpheoCases.reconstructed"))).toBeInTheDocument();
  });
});

describe("Morpheo statistics", () => {
  const STATS: FunnelCaseStats = {
    started: 7,
    byStatus: { open: 2, finished: 4, stopped: 1, paused: 0 },
    closed: 5,
    byMainAction: [{ key: "TERAPIA", count: 3 }],
    byTemplate: [
      { key: "T_INSOMNIO", count: 3 },
      { key: "T_PIERNAS", count: 1 },
      { key: "T_NUEVA", count: 1 },
    ],
    byAlert: [{ key: "EMERGENCIA", count: 1 }],
    withAlerts: 1,
    byMonth: [{ month: "2026-11", started: 7, closed: 5 }],
    firstStartedAt: "2026-11-01T09:00:00+00:00",
    lastStartedAt: "2026-11-02T09:00:00+00:00",
  };

  it("names each outcome, and shows an unknown one by its code", async () => {
    morpheoStatistics.mockResolvedValue(STATS);
    renderWithProviders(<StatisticsScreen />);

    const panel = await screen.findByRole("article", { name: t("morpheoStats.title") });
    expect(await within(panel).findByText(t("outcome.template.T_INSOMNIO"))).toBeInTheDocument();
    expect(within(panel).getByText(t("outcome.template.T_PIERNAS"))).toBeInTheDocument();
    expect(within(panel).getByText("T_NUEVA")).toBeInTheDocument();
    expect(within(panel).getByText(t("outcome.mainAction.EMERGENCIA"))).toBeInTheDocument();
    expect(within(panel).getByText("7")).toBeInTheDocument();
  });
});
