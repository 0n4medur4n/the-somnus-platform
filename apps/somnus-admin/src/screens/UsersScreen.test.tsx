import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../test/utils.js";
import { UsersScreen } from "./UsersScreen.js";

const searchUsers = vi.fn(async () => ({
  users: [
    {
      id: "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
      email: "ana@example.com",
      locale: "es" as const,
      status: "active" as const,
      createdAt: "2026-10-01T09:00:00.000Z",
    },
    {
      id: "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
      email: "luis@example.com",
      locale: "es" as const,
      status: "suspended" as const,
      createdAt: "2026-10-02T09:00:00.000Z",
    },
  ],
  truncated: false,
}));

vi.mock("../lib/edge.js", () => ({ edge: { searchUsers: (...a: []) => searchUsers(...a) } }));

const t = i18n.t.bind(i18n);

describe("UsersScreen", () => {
  it("lists the accounts as soon as it opens, without a search", async () => {
    renderWithProviders(<UsersScreen canChangeStatus={false} />);

    const table = await screen.findByTestId("user-results");
    expect(searchUsers).toHaveBeenCalledWith({ limit: 100 });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([
      "ana@example.com",
      "luis@example.com",
    ]);
    expect(within(rows[1] as HTMLElement).getByText(t("status.suspended"))).toBeInTheDocument();
  });
});
