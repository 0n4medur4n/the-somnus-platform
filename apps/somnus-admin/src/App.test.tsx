import type { AdminMeResponse } from "@somnus/api-contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContextValue } from "./auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "./test/utils.js";

const { sendLoginLink } = vi.hoisted(() => ({ sendLoginLink: vi.fn() }));
vi.mock("./auth/firebase-auth.js", () => ({
  sendLoginLink,
  isEmailLink: () => false,
  storedEmail: () => null,
  completeEmailLinkSignIn: vi.fn(),
  firebaseSignOut: vi.fn(),
}));

vi.mock("./lib/edge.js", () => ({
  edge: {
    searchUsers: vi.fn().mockResolvedValue({ users: [], truncated: false }),
    userDetail: vi.fn(),
    setUserStatus: vi.fn(),
    deletionRequests: vi.fn().mockResolvedValue([]),
    decideDeletion: vi.fn(),
    organizations: vi.fn().mockResolvedValue([]),
    createOrganization: vi.fn(),
    setOrganizationStatus: vi.fn(),
    organizationMembers: vi.fn(),
    verificationQueue: vi.fn().mockResolvedValue([]),
    decideVerification: vi.fn(),
    assignRole: vi.fn(),
    adminMe: vi.fn(),
    createSession: vi.fn(),
    logout: vi.fn(),
  },
}));

const { Gate } = await import("./App.js");

const t = (key: string, vars?: Record<string, string>) => i18n.t(key, vars ?? {});

const logout = vi.fn();

function auth(state: AdminAuthContextValue["state"]): AdminAuthContextValue {
  return { state, refresh: async () => {}, logout };
}

const ME: AdminMeResponse = {
  user: {
    id: "018f0000-0000-7000-8000-000000000abc",
    email: "verifier@somnus.test",
    locale: "es",
    status: "active",
  },
  roleKeys: ["professional_verifier"],
  capabilities: ["admin_users_read", "admin_verification_queue"],
};

/**
 * Addendum A Checkpoint 15.1: "if the session carries no internal role, the app
 * shows nothing but a denial screen."
 *
 * The console's whole client-side surface is this gate, so these assert what it
 * renders in each state -- and, for the denial, what it does NOT render.
 */
describe("the console gate", () => {
  beforeEach(() => {
    sendLoginLink.mockReset();
    sendLoginLink.mockResolvedValue(undefined);
    logout.mockReset();
  });

  it("shows a status while the gate is still deciding", () => {
    renderWithProviders(<Gate />, { auth: auth({ status: "loading" }) });
    expect(screen.getByRole("status")).toHaveTextContent(t("common.loading"));
  });

  it("shows the sign-in screen when there is no session", () => {
    renderWithProviders(<Gate />, { auth: auth({ status: "unauthenticated" }) });

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("login.title"));
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
  });

  it("sends the magic link without hinting at who is eligible", async () => {
    renderWithProviders(<Gate />, { auth: auth({ status: "unauthenticated" }) });

    await userEvent.type(screen.getByLabelText(t("login.emailLabel")), "someone@example.com");
    await userEvent.click(screen.getByRole("button", { name: t("login.sendLink") }));

    expect(sendLoginLink).toHaveBeenCalledWith("someone@example.com");
    // The same confirmation regardless of whether that address is an admin:
    // the console must not become an oracle for who holds an internal role.
    expect(await screen.findByRole("status")).toHaveTextContent("someone@example.com");
  });

  describe("denial screen", () => {
    it("says plainly that the account has no internal role", () => {
      renderWithProviders(<Gate />, { auth: auth({ status: "denied" }) });

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("denied.title"));
      expect(screen.getByRole("alert")).toHaveTextContent(t("denied.body"));
      expect(screen.getByText(t("denied.noSelfService"))).toBeInTheDocument();
    });

    it("shows NOTHING of the console: no capabilities, no roles, no navigation", () => {
      renderWithProviders(<Gate />, { auth: auth({ status: "denied" }) });

      expect(screen.queryByText(t("console.title"))).toBeNull();
      expect(screen.queryByText(t("console.capabilitiesTitle"))).toBeNull();
      expect(screen.queryByText(t("console.rolesTitle"))).toBeNull();
      expect(screen.queryByTestId("capability-list")).toBeNull();

      // Not one capability label leaks -- the denial screen must not describe
      // what the person is being denied.
      for (const capability of [
        "admin_users_read",
        "admin_verification_queue",
        "admin_break_glass",
        "admin_roles_assign",
      ]) {
        expect(screen.queryByText(t(`capability.${capability}`)), capability).toBeNull();
      }
    });

    it("offers no way to request access, only to sign out", async () => {
      renderWithProviders(<Gate />, { auth: auth({ status: "denied" }) });

      const buttons = screen.getAllByRole("button").map((b) => b.textContent);
      expect(buttons).toEqual([t("common.signOut")]);
      // The only link is the layout's skip-to-content.
      expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["#main"]);

      await userEvent.click(screen.getByRole("button", { name: t("common.signOut") }));
      expect(logout).toHaveBeenCalledTimes(1);
    });
  });

  describe("console shell", () => {
    it("renders only the capabilities the server granted", () => {
      renderWithProviders(<Gate />, { auth: auth({ status: "authorized", me: ME }) });

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("console.title"));
      expect(screen.getByText(t("role.professional_verifier"))).toBeInTheDocument();

      const listed = screen.getByTestId("capability-list").querySelectorAll("li");
      expect([...listed].map((li) => li.textContent)).toEqual([
        t("capability.admin_users_read"),
        t("capability.admin_verification_queue"),
      ]);
    });

    it("shows no control for a capability the server withheld", () => {
      renderWithProviders(<Gate />, { auth: auth({ status: "authorized", me: ME }) });

      // A verifier holds neither of these; the shell renders from the decision,
      // so it cannot offer them.
      expect(screen.queryByText(t("capability.admin_break_glass"))).toBeNull();
      expect(screen.queryByText(t("capability.admin_roles_assign"))).toBeNull();
      expect(screen.queryByText(t("capability.admin_system_health"))).toBeNull();
    });

    it("handles an internal role with no capabilities without pretending otherwise", () => {
      renderWithProviders(<Gate />, {
        auth: auth({
          status: "authorized",
          me: { ...ME, roleKeys: ["support_agent"], capabilities: [] },
        }),
      });

      expect(screen.getByText(t("console.noCapabilities"))).toBeInTheDocument();
      expect(screen.queryByTestId("capability-list")).toBeNull();
    });

    it("says the capability screens are not built yet rather than implying they are", () => {
      renderWithProviders(<Gate />, { auth: auth({ status: "authorized", me: ME }) });
      expect(screen.getByText(t("console.pendingNotice"))).toBeInTheDocument();
    });
  });

  /**
   * Addendum A Checkpoint 15.2. The console offers a section only when the
   * server said the acting admin holds its capability -- and a section that is
   * not offered has no URL either, so it cannot be reached by typing one.
   */
  describe("capability-driven navigation", () => {
    const withCapabilities = (
      capabilities: AdminMeResponse["capabilities"],
      roleKeys = ME.roleKeys,
    ) => auth({ status: "authorized", me: { ...ME, roleKeys, capabilities } });

    it("offers only the sections the server granted", () => {
      renderWithProviders(<Gate />, {
        auth: withCapabilities(["admin_users_read", "admin_verification_queue"]),
      });

      const nav = screen.getByRole("navigation");
      const items = [...nav.querySelectorAll("button")].map((b) => b.textContent);
      expect(items).toEqual([t("nav.overview"), t("nav.users"), t("nav.verification")]);
    });

    it("offers NO section at all beyond the overview when nothing is granted", () => {
      renderWithProviders(<Gate />, { auth: withCapabilities([]) });

      const nav = screen.getByRole("navigation");
      expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
        t("nav.overview"),
      ]);
    });

    it.each([
      ["admin_users_read", "nav.users"],
      ["admin_deletion_requests_process", "nav.deletions"],
      ["admin_organizations_manage", "nav.organizations"],
      ["admin_verification_queue", "nav.verification"],
      ["admin_roles_assign", "nav.roles"],
    ] as const)("hides %s's section when the capability is absent", (capability, navKey) => {
      const others = (
        [
          "admin_users_read",
          "admin_deletion_requests_process",
          "admin_organizations_manage",
          "admin_verification_queue",
          "admin_roles_assign",
        ] as const
      ).filter((c) => c !== capability);

      renderWithProviders(<Gate />, { auth: withCapabilities([...others]) });
      const nav = screen.getByRole("navigation");
      const items = [...nav.querySelectorAll("button")].map((b) => b.textContent);
      expect(items).not.toContain(t(navKey));
    });

    it("the role-assignment screen exists only for an admin holding admin_roles_assign", async () => {
      renderWithProviders(<Gate />, {
        auth: withCapabilities(["admin_roles_assign"], ["platform_super_admin"]),
      });

      await userEvent.click(screen.getByRole("button", { name: t("nav.roles") }));
      expect(screen.getByRole("heading", { name: t("roles.title") })).toBeInTheDocument();
      // Only internal roles are offered: external ones are earned, never granted.
      const options = [...screen.getByLabelText(t("roles.roleLabel")).querySelectorAll("option")]
        .map((o) => o.getAttribute("value"))
        .filter((value) => value !== "");
      expect(options).toEqual([
        "support_agent",
        "professional_verifier",
        "clinical_governance_reviewer",
        "platform_admin",
        "platform_super_admin",
      ]);
    });

    it("refuses self-assignment in the UI before the server ever has to", async () => {
      renderWithProviders(<Gate />, {
        auth: withCapabilities(["admin_roles_assign"], ["platform_super_admin"]),
      });
      await userEvent.click(screen.getByRole("button", { name: t("nav.roles") }));

      await userEvent.type(screen.getByLabelText(t("roles.targetLabel")), ME.user.id);
      await userEvent.selectOptions(screen.getByLabelText(t("roles.roleLabel")), "platform_admin");

      expect(screen.getByRole("alert")).toHaveTextContent(t("roles.noSelfAssign"));
      expect(screen.getByRole("button", { name: t("roles.assign") })).toBeDisabled();
    });

    it("the users screen offers no suspend control without admin_account_status_write", async () => {
      renderWithProviders(<Gate />, { auth: withCapabilities(["admin_users_read"]) });
      await userEvent.click(screen.getByRole("button", { name: t("nav.users") }));

      expect(screen.getByRole("heading", { name: t("users.title") })).toBeInTheDocument();
      expect(screen.queryByLabelText(t("users.reasonLabel"))).toBeNull();
    });
  });
});
