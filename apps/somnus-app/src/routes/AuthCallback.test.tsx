import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import type { AuthContextValue } from "../auth/AuthContext.js";
import { ApiRequestError } from "../lib/api.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const { isEmailLink, completeEmailLinkSignIn, storedEmail } = vi.hoisted(() => ({
  isEmailLink: vi.fn(() => false),
  completeEmailLinkSignIn: vi.fn(),
  storedEmail: vi.fn<() => string | null>(() => null),
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

/**
 * The callback screen used to render one sentence -- "your link is invalid or
 * has expired" -- for every failure of any of its three awaits. That sentence
 * asserts a cause. When the real failure was the session exchange it was untrue,
 * it sent the person to fetch another link that would fail identically, and it
 * pointed a CI investigation at the wrong component for three rounds.
 *
 * These tests are the regression: the link copy is claimed only when Firebase
 * says the link itself is unusable.
 */
describe("AuthCallback failures (the error screen must not assert a cause)", () => {
  // Spied inside beforeAll, not at describe-body time: describe bodies all run
  // during collection, so patching there would silence the other suites too.
  let consoleError: MockInstance<typeof console.error>;
  beforeAll(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterAll(() => consoleError.mockRestore());

  beforeEach(() => {
    createSession.mockReset();
    completeEmailLinkSignIn.mockReset();
    isEmailLink.mockReturnValue(true);
    storedEmail.mockReturnValue("ada@example.test");
    consoleError.mockClear();
  });

  it("a 500 from POST /v1/sessions shows the generic error, never the expired-link copy", async () => {
    completeEmailLinkSignIn.mockResolvedValue("id-token");
    createSession.mockRejectedValue(new ApiRequestError(500, "INTERNAL", "Request failed (500)"));

    renderWithProviders(<AuthCallback />);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("callback.errorGeneric"));
    expect(screen.queryByText(t("callback.error"))).not.toBeInTheDocument();
  });

  it("logs which of the three steps failed, with the status and without the link", async () => {
    completeEmailLinkSignIn.mockResolvedValue("id-token");
    createSession.mockRejectedValue(new ApiRequestError(503, "UPSTREAM", "Request failed (503)"));

    renderWithProviders(<AuthCallback />);
    await screen.findByRole("alert");

    // `session`, not `sign-in`: the emailed link was redeemed fine. This is the
    // distinction that did not exist before, and the whole reason for the change.
    expect(consoleError).toHaveBeenCalledWith("[somnus] auth-callback", {
      stage: "session",
      kind: "http",
      status: 503,
      code: "UPSTREAM",
      message: "Request failed (503)",
    });
  });

  it("an expired action code still shows the expired-link copy -- that one is accurate", async () => {
    completeEmailLinkSignIn.mockRejectedValue(
      Object.assign(new Error("expired"), { code: "auth/expired-action-code" }),
    );

    renderWithProviders(<AuthCallback />);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("callback.error"));
    expect(consoleError).toHaveBeenCalledWith("[somnus] auth-callback", {
      stage: "sign-in",
      kind: "auth",
      code: "auth/expired-action-code",
    });
  });

  it("a network failure with no code shows the generic error", async () => {
    // No `code` at all: a fetch that never reached edge-api. Nothing about that
    // says the link expired.
    completeEmailLinkSignIn.mockResolvedValue("id-token");
    createSession.mockRejectedValue(new TypeError("Failed to fetch"));

    renderWithProviders(<AuthCallback />);

    expect(await screen.findByRole("alert")).toHaveTextContent(t("callback.errorGeneric"));
    expect(screen.queryByText(t("callback.error"))).not.toBeInTheDocument();
  });
});

/**
 * Cross-device sign-in: the link opened where it was not requested.
 *
 * `storedEmail()` is null because sessionStorage belongs to the context that
 * asked for the link, so Firebase needs the address supplied again. Until
 * 2026-09-18 that was a `window.prompt`; it is now a form, and this is the path
 * that had NO test at all -- the mocks above default `isEmailLink` to false, so
 * every existing case went down the "not a magic link" branch.
 *
 * The regression these cover is specific: the auth provider calls `/v1/me` on
 * page load, every visitor arrives without a session, so the state is
 * `unauthenticated` while the form is on screen. A guard that treats
 * "unauthenticated and not verifying" as failure turns the form into the error
 * screen before the person can type anything -- which is exactly what shipped and
 * what a real sign-in from Gmail hit.
 */
describe("cross-device confirmation (the link opened in another context)", () => {
  beforeEach(() => {
    // Reset call history as well as return values: these mocks are module-level
    // and the suites above leave calls on them, which would make
    // "was never called" assertions here read the previous test's work.
    createSession.mockReset();
    completeEmailLinkSignIn.mockReset();
    isEmailLink.mockReturnValue(true);
    storedEmail.mockReturnValue(null);
  });

  it("asks for the email on a screen instead of failing", async () => {
    renderWithProviders(<AuthCallback />);

    // The form, not the error screen -- with the default `unauthenticated` auth
    // state, which is what a real page load produces.
    expect(await screen.findByText(t("callback.emailTitle"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Nothing was redeemed: there was no address to redeem with.
    expect(completeEmailLinkSignIn).not.toHaveBeenCalled();
  });

  it("redeems the link with the address the person types", async () => {
    completeEmailLinkSignIn.mockResolvedValue("id-token");
    createSession.mockResolvedValue(undefined);

    renderWithProviders(<AuthCallback />);
    await screen.findByText(t("callback.emailTitle"));

    await userEvent.type(screen.getByLabelText(t("login.emailLabel")), "ada@example.org");
    await userEvent.click(screen.getByRole("button", { name: t("callback.emailSubmit") }));

    await waitFor(() =>
      expect(completeEmailLinkSignIn).toHaveBeenCalledWith("ada@example.org", window.location.href),
    );
    expect(createSession).toHaveBeenCalledWith("id-token");
  });

  it("keeps the person on the form when the address does not match the link", async () => {
    // `auth/invalid-email` is deliberately NOT `link-invalid` (see
    // auth-failure.ts): the link is still valid and unconsumed, so a typo is
    // recoverable and must not end the flow.
    completeEmailLinkSignIn.mockRejectedValue(
      Object.assign(new Error("bad email"), { code: "auth/invalid-email" }),
    );

    renderWithProviders(<AuthCallback />);
    await screen.findByText(t("callback.emailTitle"));

    await userEvent.type(screen.getByLabelText(t("login.emailLabel")), "wrong@example.org");
    await userEvent.click(screen.getByRole("button", { name: t("callback.emailSubmit") }));

    // Twice, as every other field error in this app appears: once in the error
    // summary that links to the field, once beside the field itself.
    expect(await screen.findAllByText(t("callback.emailMismatch"))).toHaveLength(2);
    // Still the form, and still usable.
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
    expect(screen.queryByText(t("callback.errorGeneric"))).not.toBeInTheDocument();
  });

  it("ends the flow when the link itself is dead", async () => {
    completeEmailLinkSignIn.mockRejectedValue(
      Object.assign(new Error("expired"), { code: "auth/expired-action-code" }),
    );

    renderWithProviders(<AuthCallback />);
    await screen.findByText(t("callback.emailTitle"));

    await userEvent.type(screen.getByLabelText(t("login.emailLabel")), "ada@example.org");
    await userEvent.click(screen.getByRole("button", { name: t("callback.emailSubmit") }));

    // Retrying cannot help here, so this one IS terminal.
    expect(await screen.findByRole("alert")).toHaveTextContent(t("callback.error"));
  });
});
