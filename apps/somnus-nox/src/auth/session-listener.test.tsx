import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gate } from "../App.js";
import type { NoxMeReader } from "../api/load-nox-me.js";
import i18n from "../i18n/index.js";
import { NoxAuthProvider } from "./NoxAuthProvider.js";
import { useNoxAuth } from "./useNoxAuth.js";

const authState: { currentUser: { uid: string } | null } = { currentUser: null };
const firebaseSignOut = vi.fn();

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, next: (user: { uid: string } | null) => void) => {
    next(authState.currentUser);
    return () => {};
  },
}));

vi.mock("../lib/firebase.js", () => ({
  getFirebaseAuth: () => authState,
}));

vi.mock("./firebase-auth.js", () => ({
  firebaseSignOut: () => firebaseSignOut(),
  sendLoginLink: vi.fn(),
  isEmailLink: () => false,
  storedEmail: () => null,
  completeEmailLinkSignIn: vi.fn(),
  withApiKey: (url: string) => url,
}));

function Refresh() {
  const { refresh } = useNoxAuth();
  return (
    <button type="button" onClick={() => void refresh()}>
      refresh
    </button>
  );
}

const t = (key: string) => i18n.t(key);
const grant: NoxMeReader = async () => ({ verifiedProfessional: true, noxAccess: true });

describe("firebase session listener and refresh", () => {
  beforeEach(() => {
    authState.currentUser = null;
    firebaseSignOut.mockReset();
    firebaseSignOut.mockResolvedValue(undefined);
    window.history.pushState({}, "", "/");
  });

  it("shows sign-in when Firebase has no user", () => {
    render(
      <NoxAuthProvider reader={grant}>
        <Gate />
      </NoxAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: t("login.title") })).toBeInTheDocument();
  });

  it("loads /nox/v1/me when Firebase already has a user", async () => {
    authState.currentUser = { uid: "physician" };
    render(
      <NoxAuthProvider reader={grant}>
        <Gate />
      </NoxAuthProvider>,
    );
    expect(await screen.findByTestId("nox-module-list")).toBeInTheDocument();
  });

  it("refresh follows the signed-in reader and the signed-out state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <NoxAuthProvider session="signed-in" reader={grant}>
        <Refresh />
        <Gate />
      </NoxAuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByTestId("nox-module-list")).toBeInTheDocument();

    rerender(
      <NoxAuthProvider session="signed-out" reader={grant}>
        <Refresh />
        <Gate />
      </NoxAuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
  });

  it("refresh uses the dev preview and denies when sign-out throws", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/?preview=denied");
    firebaseSignOut.mockRejectedValue(new Error("already-gone"));
    render(
      <NoxAuthProvider reader={grant}>
        <Refresh />
        <Gate />
      </NoxAuthProvider>,
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: t("denied.title") }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(screen.getByRole("heading", { level: 1, name: t("denied.title") })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("common.signOut") }));
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
  });
});
