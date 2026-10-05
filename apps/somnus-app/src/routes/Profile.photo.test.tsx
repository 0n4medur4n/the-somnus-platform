import type { MeResponse } from "@somnus/api-contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContextValue } from "../auth/AuthContext.js";
import { i18n, renderWithProviders } from "../test/utils.js";

const edge = vi.hoisted(() => ({
  patchProfile: vi.fn(),
  uploadPhoto: vi.fn(),
  removePhoto: vi.fn(),
  photoUrl: vi.fn((version: string) => `/v1/me/photo?v=${version}`),
}));
vi.mock("../lib/edge.js", () => ({ edge }));
const prepareProfilePhoto = vi.hoisted(() => vi.fn());
vi.mock("../lib/photo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/photo.js")>()),
  prepareProfilePhoto,
}));

const { Profile } = await import("./Profile.js");
const { PhotoPrepFailure } = await import("../lib/photo.js");

function authFor(profile: Partial<NonNullable<MeResponse["individualProfile"]>> = {}) {
  const value: AuthContextValue = {
    state: {
      status: "authenticated",
      me: {
        user: { id: "u", email: "ada@example.com", locale: "es", status: "active" },
        individualProfile: { firstName: "Ada", lastName: "Lovelace", ...profile },
        professionalProfile: null,
        account: { registrationRole: "adult", internalRoles: [], organizations: [] },
      },
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn(),
  };
  return value;
}

const t = (key: string) => i18n.t(key);
const fileInput = () => document.querySelector<HTMLInputElement>("input[type=file]");

describe("Profile: photo and complete details", () => {
  beforeEach(() => {
    for (const fn of Object.values(edge)) fn.mockReset();
    edge.photoUrl.mockImplementation((version: string) => `/v1/me/photo?v=${version}`);
    prepareProfilePhoto.mockReset();
  });

  it("re-encodes the picked photo, uploads it, and refreshes the profile", async () => {
    const prepared = new Blob(["webp"], { type: "image/webp" });
    prepareProfilePhoto.mockResolvedValue(prepared);
    edge.uploadPhoto.mockResolvedValue(undefined);
    const auth = authFor();
    renderWithProviders(<Profile />, { auth });

    const picked = new File(["raw"], "me.jpg", { type: "image/jpeg" });
    await userEvent.upload(fileInput() as HTMLInputElement, picked);

    expect(await screen.findByText(t("profile.photoSaved"))).toBeInTheDocument();
    expect(prepareProfilePhoto).toHaveBeenCalledWith(picked);
    expect(edge.uploadPhoto).toHaveBeenCalledWith(prepared);
    expect(auth.refresh).toHaveBeenCalled();
  });

  it("explains a photo that is too large, without uploading anything", async () => {
    prepareProfilePhoto.mockRejectedValue(new PhotoPrepFailure("too_large"));
    renderWithProviders(<Profile />, { auth: authFor() });

    await userEvent.upload(
      fileInput() as HTMLInputElement,
      new File(["x"], "big.jpg", { type: "image/jpeg" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(t("profile.photoTooBig"));
    expect(edge.uploadPhoto).not.toHaveBeenCalled();
  });

  it("removes an existing photo", async () => {
    edge.removePhoto.mockResolvedValue(undefined);
    renderWithProviders(<Profile />, {
      auth: authFor({ photoUpdatedAt: "2026-10-05T10:00:00.000Z" }),
    });

    expect(screen.getByRole("img", { name: t("profile.photoAlt") })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("profile.removePhoto") }));
    expect(await screen.findByText(t("profile.photoRemoved"))).toBeInTheDocument();
    expect(edge.removePhoto).toHaveBeenCalledTimes(1);
  });

  it("saves date of birth, phone and language, and clears an emptied phone with null", async () => {
    edge.patchProfile.mockResolvedValue(undefined);
    renderWithProviders(<Profile />, { auth: authFor({ phone: "600111222" }) });

    await userEvent.type(screen.getByLabelText(t("profile.dateOfBirth")), "1990-04-12");
    await userEvent.clear(screen.getByLabelText(t("profile.phone")));
    await userEvent.selectOptions(screen.getByLabelText(t("profile.language")), "ca");
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    await waitFor(() =>
      expect(edge.patchProfile).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "Lovelace",
        dateOfBirth: "1990-04-12",
        phone: null,
        locale: "ca",
      }),
    );
    await i18n.changeLanguage("es");
  });

  it("refuses a date of birth that would make the account holder a minor", async () => {
    renderWithProviders(<Profile />, { auth: authFor() });

    const minor = `${new Date().getUTCFullYear() - 10}-01-01`;
    await userEvent.type(screen.getByLabelText(t("profile.dateOfBirth")), minor);
    await userEvent.click(screen.getByRole("button", { name: t("common.save") }));

    expect((await screen.findAllByText(t("profile.errors.dateOfBirth"))).length).toBeGreaterThan(0);
    expect(edge.patchProfile).not.toHaveBeenCalled();
  });

  it("shows the sign-in email and account type, which are not editable here", () => {
    renderWithProviders(<Profile />, { auth: authFor() });
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText(t("space.accountType.adult"))).toBeInTheDocument();
    expect(screen.queryByDisplayValue("ada@example.com")).toBeNull();
  });
});
