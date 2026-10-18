import type { AdminMeResponse, AdminUsersOverview } from "@somnus/api-contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";

const OVERVIEW: AdminUsersOverview = {
  total: 128,
  byStatus: { active: 120, suspended: 3, deleted: 5 },
  byRegistrationRole: { adult: 90, parent: 20, professional: 10, unknown: 3 },
  newLast7Days: 4,
  newLast30Days: 17,
  weekly: Array.from({ length: 12 }, (_, i) => ({
    weekStart: new Date(Date.UTC(2026, 6, 27 + i * 7)).toISOString().slice(0, 10),
    count: i,
  })),
  generatedAt: "2026-10-18T12:00:00.000Z",
};

vi.mock("../lib/edge.js", () => ({
  edge: {
    usersOverview: vi.fn(async () => OVERVIEW),
    deletionRequests: vi.fn(async () => [{}, {}]),
    verificationQueue: vi.fn(async () => []),
    contentReviewQueue: vi.fn(async () => ({ items: [] })),
    organizations: vi.fn(async () => []),
    statistics: vi.fn(async () => ({
      counts: {
        assessmentsStarted: 0,
        assessmentsCompleted: 0,
        reportsRequested: 0,
        reportsGenerated: 0,
        notificationsRequested: 0,
        organizationsCreated: 0,
      },
      rowsConsidered: 0,
    })),
  },
}));

const { ConsoleHome } = await import("../routes/ConsoleHome.js");
const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars ?? {});

const ME: AdminMeResponse = {
  user: {
    id: "018f0000-0000-7000-8000-000000000abc",
    email: "admin@thesomnus.com",
    locale: "es",
    status: "active",
  },
  roleKeys: ["platform_admin"],
  capabilities: ["admin_users_read", "admin_deletion_requests_process", "admin_statistics_read"],
};

describe("the dashboard", () => {
  it("shows real account figures, pending work, and an honest note where events are missing", async () => {
    renderWithProviders(<ConsoleHome me={ME} />);

    expect(await screen.findByText("128")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText(t("dashboard.newAccounts7", { count: 4 }))).toBeInTheDocument();
    // Two deletion requests waiting: on the tile, and as a badge in the sidebar.
    expect(await screen.findByText(t("dashboard.review"))).toBeInTheDocument();
    expect(screen.getByText(t("console.pendingCount", { count: 2 }))).toBeInTheDocument();
    // No events reached the audit store yet: said in words, not shown as "0 activity".
    expect(screen.getByText(t("dashboard.noEventsYet"))).toBeInTheDocument();
  });

  it("every chart has a table view with the same numbers", async () => {
    renderWithProviders(<ConsoleHome me={ME} />);
    await screen.findByText("128");
    const weekly = (
      await screen.findByRole("heading", { name: t("dashboard.signupsByWeek") })
    ).closest("section") as HTMLElement;
    await userEvent.click(within(weekly).getByRole("button", { name: t("charts.showTable") }));
    const rows = within(weekly).getAllByRole("row");
    expect(rows).toHaveLength(13); // header + 12 weeks
    expect(rows.at(-1)).toHaveTextContent("11");

    const types = screen
      .getByRole("heading", { name: t("dashboard.accountTypes") })
      .closest("section") as HTMLElement;
    expect(within(types).getByText(t("dashboard.type.adult"))).toBeInTheDocument();
    expect(within(types).getByText(/90/)).toBeInTheDocument();
  });

  it("offers no block whose capability was not granted", async () => {
    renderWithProviders(<ConsoleHome me={{ ...ME, capabilities: ["admin_drive"] }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("console.title"));
    expect(screen.queryByText(t("dashboard.accounts"))).toBeNull();
    expect(screen.queryByText(t("dashboard.attention"))).toBeNull();
    expect(screen.queryByText(t("dashboard.activity"))).toBeNull();
    const nav = screen.getByRole("navigation");
    expect(
      within(nav)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([t("nav.overview"), t("nav.drive")]);
  });
});
