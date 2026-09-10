import {
  ADMIN_CAPABILITIES,
  type AdminCapability,
  type AdminMeResponse,
  BREAK_GLASS_JUSTIFICATION_MIN_LENGTH,
  INTERNAL_ROLE_KEYS,
  ROLE_KEYS,
  type RoleKey,
} from "@somnus/api-contracts";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContextValue } from "../auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { breakGlassReveal } = vi.hoisted(() => ({ breakGlassReveal: vi.fn() }));
vi.mock("../lib/edge.js", () => ({
  edge: {
    breakGlassReveal,
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

const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars ?? {});

const ACTOR = "018f0000-0000-7000-8000-000000000abc";
const SUBJECT = "018f0000-0000-7000-8000-0000000000fe";
const GOOD_JUSTIFICATION = "Safeguarding escalation raised by the on-call clinician this morning.";

/** The §A2.2 rows, transcribed here rather than imported, so this can disagree. */
const CAPABILITIES_BY_ROLE: Record<string, AdminCapability[]> = {
  support_agent: ["admin_users_read", "admin_statistics_read", "admin_consent_read"],
  professional_verifier: ["admin_users_read", "admin_verification_queue"],
  clinical_governance_reviewer: [
    "admin_content_review",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_break_glass",
  ],
  platform_admin: [
    "admin_users_read",
    "admin_account_status_write",
    "admin_deletion_requests_process",
    "admin_verification_queue",
    "admin_organizations_manage",
    "admin_statistics_read",
    "admin_audit_read",
    "admin_consent_read",
    "admin_break_glass",
    "admin_system_health",
  ],
  platform_super_admin: ["admin_users_read", "admin_roles_assign", "admin_break_glass"],
};

function authorized(roleKeys: RoleKey[], capabilities: AdminCapability[]): AdminAuthContextValue {
  const me: AdminMeResponse = {
    user: { id: ACTOR, email: "admin@somnus.test", locale: "es", status: "active" },
    roleKeys,
    capabilities,
  };
  return { state: { status: "authorized", me }, refresh: async () => {}, logout: vi.fn() };
}

/**
 * Break-glass in the console (Addendum A §A2.3 / Checkpoint 15.5).
 *
 * The negative half is parametrized over EVERY role, internal and external, not
 * just the two §A4 names. Two roles named in a spec is a test that passes for
 * the roles someone thought about; the matrix is what actually decides, so the
 * matrix is what is walked.
 *
 * "Never see the reveal control" is asserted as structural absence: no nav
 * entry, no heading, no button, and no view id to type — the console has no URL
 * for a section it did not offer, so there is nothing to reach.
 */
describe("who can see break-glass at all", () => {
  beforeEach(() => {
    breakGlassReveal.mockReset();
  });

  const HOLDERS: RoleKey[] = [
    "clinical_governance_reviewer",
    "platform_admin",
    "platform_super_admin",
  ];
  const INTERNAL = ROLE_KEYS.filter((key) => INTERNAL_ROLE_KEYS.has(key));
  const EXTERNAL = ROLE_KEYS.filter((key) => !INTERNAL_ROLE_KEYS.has(key));

  it.each(INTERNAL.filter((role) => !HOLDERS.includes(role)))(
    "%s: the control is structurally absent, not disabled",
    (role) => {
      renderWithProviders(<Gate />, {
        auth: authorized([role], CAPABILITIES_BY_ROLE[role] ?? []),
      });

      const nav = screen.getByRole("navigation");
      expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
        t("nav.breakGlass"),
      );
      // Not merely hidden behind a disabled control either.
      expect(screen.queryByRole("button", { name: t("breakGlass.reveal") })).toBeNull();
      expect(screen.queryByRole("heading", { name: t("breakGlass.title") })).toBeNull();
      expect(screen.queryByLabelText(t("breakGlass.justificationLabel"))).toBeNull();
    },
  );

  it.each(EXTERNAL)("%s: sees the denial screen, so no console surface at all", (role) => {
    renderWithProviders(<Gate />, {
      auth: { ...authorized([role], []), state: { status: "denied" } },
    });

    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(t("nav.breakGlass"))).toBeNull();
  });

  it.each(HOLDERS)("%s: is offered the section", (role) => {
    renderWithProviders(<Gate />, {
      auth: authorized([role], CAPABILITIES_BY_ROLE[role] ?? []),
    });

    const nav = screen.getByRole("navigation");
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toContain(
      t("nav.breakGlass"),
    );
  });

  it("holding every capability EXCEPT admin_break_glass is still not enough", () => {
    const everythingElse = ADMIN_CAPABILITIES.filter((c) => c !== "admin_break_glass");
    renderWithProviders(<Gate />, {
      auth: authorized(["platform_super_admin"], [...everythingElse]),
    });

    const nav = screen.getByRole("navigation");
    expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      t("nav.breakGlass"),
    );
  });
});

describe("the reveal is impossible without a justification", () => {
  beforeEach(() => {
    breakGlassReveal.mockReset();
    breakGlassReveal.mockResolvedValue({
      subjectUserId: SUBJECT,
      revealedAt: "2026-09-10T09:00:00.000Z",
      auditEventId: "018f0000-0000-7000-8000-00000000aaaa",
      snapshots: [],
    });
  });

  async function open() {
    renderWithProviders(<Gate />, {
      auth: authorized(["clinical_governance_reviewer"], ["admin_break_glass"]),
    });
    await userEvent.click(screen.getByRole("button", { name: t("nav.breakGlass") }));
  }

  it("the reveal control does nothing until a subject, a category and a reason exist", async () => {
    await open();

    const reveal = screen.getByRole("button", { name: t("breakGlass.reveal") });
    expect(reveal).toBeDisabled();

    await userEvent.type(screen.getByLabelText(t("breakGlass.subjectLabel")), SUBJECT);
    expect(reveal).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText(t("breakGlass.categoryLabel")), "safety");
    expect(reveal).toBeDisabled();

    await userEvent.click(reveal);
    expect(breakGlassReveal).not.toHaveBeenCalled();
  });

  it("a justification below the minimum length is refused, and says how far short", async () => {
    await open();
    const tooShort = "x".repeat(BREAK_GLASS_JUSTIFICATION_MIN_LENGTH - 5);

    await userEvent.type(screen.getByLabelText(t("breakGlass.subjectLabel")), SUBJECT);
    await userEvent.selectOptions(screen.getByLabelText(t("breakGlass.categoryLabel")), "support");
    await userEvent.type(screen.getByLabelText(t("breakGlass.justificationLabel")), tooShort);

    expect(screen.getByRole("button", { name: t("breakGlass.reveal") })).toBeDisabled();
    expect(screen.getByText(t("breakGlass.charactersShort", { count: 5 }))).toBeInTheDocument();
    expect(breakGlassReveal).not.toHaveBeenCalled();
  });

  it("whitespace is not a justification", async () => {
    await open();

    await userEvent.type(screen.getByLabelText(t("breakGlass.subjectLabel")), SUBJECT);
    await userEvent.selectOptions(screen.getByLabelText(t("breakGlass.categoryLabel")), "legal");
    await userEvent.type(
      screen.getByLabelText(t("breakGlass.justificationLabel")),
      " ".repeat(BREAK_GLASS_JUSTIFICATION_MIN_LENGTH + 5),
    );

    expect(screen.getByRole("button", { name: t("breakGlass.reveal") })).toBeDisabled();
  });

  it("sends the category and the reason with the request, and shows the audit reference", async () => {
    await open();

    await userEvent.type(screen.getByLabelText(t("breakGlass.subjectLabel")), SUBJECT);
    await userEvent.selectOptions(screen.getByLabelText(t("breakGlass.categoryLabel")), "safety");
    await userEvent.type(
      screen.getByLabelText(t("breakGlass.justificationLabel")),
      GOOD_JUSTIFICATION,
    );
    await userEvent.click(screen.getByRole("button", { name: t("breakGlass.reveal") }));

    expect(breakGlassReveal).toHaveBeenCalledWith({
      subjectUserId: SUBJECT,
      category: "safety",
      justification: GOOD_JUSTIFICATION,
    });
    expect(
      await screen.findByText(
        t("breakGlass.auditReference", { id: "018f0000-0000-7000-8000-00000000aaaa" }),
      ),
    ).toBeInTheDocument();
  });

  it("closing the result puts the form back empty: the next access needs its own reason", async () => {
    await open();

    await userEvent.type(screen.getByLabelText(t("breakGlass.subjectLabel")), SUBJECT);
    await userEvent.selectOptions(screen.getByLabelText(t("breakGlass.categoryLabel")), "other");
    await userEvent.type(
      screen.getByLabelText(t("breakGlass.justificationLabel")),
      GOOD_JUSTIFICATION,
    );
    await userEvent.click(screen.getByRole("button", { name: t("breakGlass.reveal") }));

    await userEvent.click(await screen.findByRole("button", { name: t("breakGlass.close") }));

    expect(screen.getByLabelText(t("breakGlass.justificationLabel"))).toHaveValue("");
    expect(screen.getByRole("button", { name: t("breakGlass.reveal") })).toBeDisabled();
  });
});
