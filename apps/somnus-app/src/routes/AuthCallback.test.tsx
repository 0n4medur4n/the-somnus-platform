import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../auth/AuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { isEmailLink, completeEmailLinkSignIn, storedEmail } = vi.hoisted(() => ({
  isEmailLink: vi.fn(() => false),
  completeEmailLinkSignIn: vi.fn(),
  storedEmail: vi.fn(() => null),
}));
vi.mock("../auth/firebase-auth.js", () => ({
  isEmailLink,
  completeEmailLinkSignIn,
  storedEmail,
}));

const { register, createSession } = vi.hoisted(() => ({
  register: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock("../lib/edge.js", () => ({ edge: { register, createSession } }));

const { AuthCallback } = await import("./AuthCallback.js");

const needsRegistration: AuthContextValue = {
  state: { status: "needs-registration" },
  refresh: async () => {},
  logout: async () => {},
};

const t = (key: string) => i18n.t(key);

/** Step 1 -> step 2: the name is common to every branch. */
async function fillNameAndChooseRole(role: "adult" | "parent" | "professional", roleLabel: string) {
  await userEvent.type(screen.getByLabelText(t("register.firstName")), "Ada");
  await userEvent.type(screen.getByLabelText(t("register.lastName")), "Lovelace");
  await userEvent.click(screen.getByRole("button", { name: t("register.next") }));

  await screen.findByText(t("register.roleTitle"));
  await userEvent.click(screen.getByRole("radio", { name: new RegExp(roleLabel, "i") }));
  await userEvent.click(screen.getByRole("button", { name: t("register.next") }));
  return role;
}

async function acceptBothConsents() {
  await userEvent.click(screen.getByLabelText(t("register.consentTerms")));
  await userEvent.click(screen.getByLabelText(t("register.consentPrivacy")));
}

describe("AuthCallback registration (Addendum A Checkpoint 14.1: one flow, three branches)", () => {
  beforeEach(() => {
    register.mockReset();
    register.mockResolvedValue({});
    isEmailLink.mockReturnValue(false);
  });

  it("adult branch: submits role, ageYears and both consent purposes", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("adult", t("register.roleAdult"));
    await screen.findByText(t("register.adultTitle"));

    await userEvent.type(screen.getByLabelText(t("register.ageLabel")), "34");
    await acceptBothConsents();
    await userEvent.click(screen.getByRole("button", { name: t("register.submit") }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith({
      role: "adult",
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "es",
      ageYears: 34,
      consents: { termsAcceptance: true, privacyPolicyAcknowledgement: true },
    });
  });

  it("parent branch: the UI says 'madre, padre o tutor legal' but the wire value stays `parent`", async () => {
    // The label the user reads and the contract value are different things.
    expect(t("register.roleParent")).toContain("madre, padre o tutor legal");

    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("parent", t("register.roleParent"));
    await screen.findByText(t("register.parentTitle"));

    await userEvent.click(screen.getByLabelText(t("register.guardianshipLabel")));
    await userEvent.selectOptions(screen.getByLabelText(t("register.minorAgeBandLabel")), "6-12y");
    await acceptBothConsents();
    await userEvent.click(screen.getByRole("button", { name: t("register.submit") }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith({
      role: "parent",
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "es",
      guardianshipConfirmed: true,
      minorAgeBand: "6-12y",
      consents: { termsAcceptance: true, privacyPolicyAcknowledgement: true },
    });
  });

  it("professional branch: submits specialty and licence, and warns that access is not granted yet", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("professional", t("register.roleProfessional"));
    await screen.findByText(t("register.professionalTitle"));

    // Addendum A §A1: the screen states plainly that the account behaves as an
    // individual until a verifier approves it.
    expect(screen.getByText(t("register.verificationNotice"))).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText(t("register.specialtyLabel")),
      "sleep_physician",
    );
    await userEvent.type(screen.getByLabelText(t("register.licenseLabel")), "COL-12345");
    await acceptBothConsents();
    await userEvent.click(screen.getByRole("button", { name: t("register.submit") }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith({
      role: "professional",
      firstName: "Ada",
      lastName: "Lovelace",
      locale: "es",
      specialty: "sleep_physician",
      licenseNumber: "COL-12345",
      consents: { termsAcceptance: true, privacyPolicyAcknowledgement: true },
    });
  });

  // --- Negatives (Addendum A §A3 Checkpoint 14.1) ---

  it("rejects an adult who declares a minor age and never calls the API", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("adult", t("register.roleAdult"));
    await screen.findByText(t("register.adultTitle"));

    await userEvent.type(screen.getByLabelText(t("register.ageLabel")), "15");
    await acceptBothConsents();
    await userEvent.click(screen.getByRole("button", { name: t("register.submit") }));

    // Twice: once in the focusable error summary, once beside the field
    // (build plan §20 9.1 a11y baseline).
    expect(await screen.findAllByText(t("register.errors.ageMin"))).toHaveLength(2);
    expect(register).not.toHaveBeenCalled();
  });

  it("a guardian cannot skip the guardianship confirmation", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("parent", t("register.roleParent"));
    await screen.findByText(t("register.parentTitle"));

    // Everything else filled in; only the guardianship box is left unchecked.
    await userEvent.selectOptions(screen.getByLabelText(t("register.minorAgeBandLabel")), "3-5y");
    await acceptBothConsents();
    await userEvent.click(screen.getByRole("button", { name: t("register.submit") }));

    // Twice: once in the focusable error summary, once beside the field
    // (build plan §20 9.1 a11y baseline).
    expect(await screen.findAllByText(t("register.errors.guardianship"))).toHaveLength(2);
    expect(register).not.toHaveBeenCalled();
  });

  it("neither consent purpose can be skipped, and they are two separate checkboxes", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("adult", t("register.roleAdult"));
    await screen.findByText(t("register.adultTitle"));

    await userEvent.type(screen.getByLabelText(t("register.ageLabel")), "34");
    // Only the terms box: the privacy acknowledgement is a separate purpose and
    // is never implied by it (build plan §13).
    await userEvent.click(screen.getByLabelText(t("register.consentTerms")));
    await userEvent.click(screen.getByRole("button", { name: t("register.submit") }));

    // Twice: once in the focusable error summary, once beside the field
    // (build plan §20 9.1 a11y baseline).
    expect(await screen.findAllByText(t("register.errors.consentRequired"))).toHaveLength(2);
    expect(register).not.toHaveBeenCalled();
  });

  it("requires a role to be chosen before the branch step is reachable", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await userEvent.type(screen.getByLabelText(t("register.firstName")), "Ada");
    await userEvent.type(screen.getByLabelText(t("register.lastName")), "Lovelace");
    await userEvent.click(screen.getByRole("button", { name: t("register.next") }));

    await screen.findByText(t("register.roleTitle"));
    await userEvent.click(screen.getByRole("button", { name: t("register.next") }));

    expect(await screen.findByText(t("register.errors.roleRequired"))).toBeInTheDocument();
    expect(screen.queryByText(t("register.adultTitle"))).not.toBeInTheDocument();
  });

  it("going back from the branch step keeps the chosen role and the name", async () => {
    renderWithProviders(<AuthCallback />, { auth: needsRegistration });
    await screen.findByText(t("register.nameTitle"));

    await fillNameAndChooseRole("professional", t("register.roleProfessional"));
    await screen.findByText(t("register.professionalTitle"));

    await userEvent.click(screen.getByRole("button", { name: t("register.back") }));
    await screen.findByText(t("register.roleTitle"));
    expect(
      screen.getByRole("radio", { name: new RegExp(t("register.roleProfessional"), "i") }),
    ).toBeChecked();

    await userEvent.click(screen.getByRole("button", { name: t("register.back") }));
    await screen.findByText(t("register.nameTitle"));
    expect(screen.getByLabelText(t("register.firstName"))).toHaveValue("Ada");
  });
});
