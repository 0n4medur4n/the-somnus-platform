import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNoxAuth } from "./useNoxAuth.js";

const { authState, listeners, firebaseSignOut } = vi.hoisted(() => ({
  authState: { currentUser: null as { uid: string } | null },
  listeners: [] as Array<(user: { uid: string } | null) => void>,
  firebaseSignOut: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (_auth: unknown, next: (user: { uid: string } | null) => void) => {
    listeners.push(next);
    return () => {};
  },
}));

vi.mock("../lib/firebase.js", () => ({
  getFirebaseAuth: () => authState,
}));

vi.mock("./firebase-auth.js", () => ({
  firebaseSignOut,
}));

const { NoxAuthProvider } = await import("./NoxAuthProvider.js");

function Probe({ children }: { children?: ReactNode }) {
  const { state, refresh, logout } = useNoxAuth();
  return (
    <>
      <p>{state.status}</p>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
      <button type="button" onClick={() => void logout()}>
        logout
      </button>
      {children}
    </>
  );
}

describe("session listener and refresh", () => {
  beforeEach(() => {
    listeners.length = 0;
    authState.currentUser = null;
    firebaseSignOut.mockReset();
    firebaseSignOut.mockResolvedValue(undefined);
    window.history.pushState({}, "", "/");
  });

  it("follows Firebase: no user is signed out, a user is checked", async () => {
    render(
      <NoxAuthProvider reader={async () => ({ verifiedProfessional: true, noxAccess: true })}>
        <Probe />
      </NoxAuthProvider>,
    );
    expect(listeners).toHaveLength(1);
    const listener = listeners[0];
    if (!listener) throw new Error("missing listener");
    listener(null);
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
    listener({ uid: "person" });
    expect(await screen.findByText("granted")).toBeInTheDocument();
  });

  it("refresh denies when the signed-in reader is not an explicit grant", async () => {
    const user = userEvent.setup();
    render(
      <NoxAuthProvider
        session="signed-in"
        reader={async () => ({ verifiedProfessional: false, noxAccess: true })}
      >
        <Probe />
      </NoxAuthProvider>,
    );
    expect(await screen.findByText("denied")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(screen.getByText("denied")).toBeInTheDocument();
  });

  it("refresh without a Firebase user returns to the login state", async () => {
    const user = userEvent.setup();
    render(
      <NoxAuthProvider>
        <Probe />
      </NoxAuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
  });

  it("refresh honors the dev preview and a signed-out override", async () => {
    const user = userEvent.setup();
    window.history.pushState({}, "", "/?preview=dashboard");
    const dashboard = render(
      <NoxAuthProvider>
        <Probe />
      </NoxAuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByText("granted")).toBeInTheDocument();
    dashboard.unmount();

    window.history.pushState({}, "", "/?preview=denied");
    const denied = render(
      <NoxAuthProvider>
        <Probe />
      </NoxAuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByText("denied")).toBeInTheDocument();
    denied.unmount();

    render(
      <NoxAuthProvider session="signed-out">
        <Probe />
      </NoxAuthProvider>,
    );
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
  });

  it("refresh rechecks a signed-in override, and logout still clears a failed sign-out", async () => {
    const user = userEvent.setup();
    firebaseSignOut.mockRejectedValue(new Error("already"));
    render(
      <NoxAuthProvider
        session="signed-in"
        reader={async () => ({ verifiedProfessional: true, noxAccess: true })}
      >
        <Probe />
      </NoxAuthProvider>,
    );
    expect(await screen.findByText("granted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "refresh" }));
    expect(await screen.findByText("granted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "logout" }));
    expect(await screen.findByText("unauthenticated")).toBeInTheDocument();
  });
});
