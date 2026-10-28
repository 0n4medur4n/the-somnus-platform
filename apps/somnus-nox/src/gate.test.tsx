import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gate } from "./App.js";
import type { NoxMeReader } from "./api/load-nox-me.js";
import { NoxAuthProvider } from "./auth/NoxAuthProvider.js";
import i18n from "./i18n/index.js";

const { firebaseSignOut, sendLoginLink } = vi.hoisted(() => ({
  firebaseSignOut: vi.fn(),
  sendLoginLink: vi.fn(),
}));

vi.mock("./auth/firebase-auth.js", () => ({
  firebaseSignOut,
  sendLoginLink,
  isEmailLink: () => false,
  storedEmail: () => null,
  completeEmailLinkSignIn: vi.fn(),
  withApiKey: (url: string) => url,
}));

const t = (key: string) => i18n.t(key);

function renderSignedIn(reader: NoxMeReader, timeoutMs?: number) {
  return render(
    <NoxAuthProvider
      session="signed-in"
      reader={reader}
      {...(timeoutMs === undefined ? {} : { timeoutMs })}
    >
      <Gate />
    </NoxAuthProvider>,
  );
}

async function expectDenialOnly() {
  expect(
    await screen.findByRole("heading", { level: 1, name: t("denied.title") }),
  ).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(t("denied.body"));
  expect(screen.queryByTestId("nox-module-list")).toBeNull();
  expect(screen.queryByText(t("modules.assistant.title"))).toBeNull();
  expect(screen.queryByText(t("modules.evidence.title"))).toBeNull();
  expect(screen.queryByText(t("dashboard.intro"))).toBeNull();
  expect(screen.queryByLabelText(t("login.emailLabel"))).toBeNull();
  expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#main"]);
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
    t("common.signOut"),
  ]);
}

describe("without an explicit grant the shell is only the denial screen", () => {
  beforeEach(() => {
    firebaseSignOut.mockReset();
    firebaseSignOut.mockResolvedValue(undefined);
    sendLoginLink.mockReset();
  });

  it.each([
    ["not a verified professional", { verifiedProfessional: false, noxAccess: true }],
    ["no Nox access", { verifiedProfessional: true, noxAccess: false }],
    ["neither flag", { verifiedProfessional: false, noxAccess: false }],
    ["missing flag", { verifiedProfessional: true }],
    ["empty object", {}],
    ["null", null],
    ["string", "granted"],
    ["stringly true", { verifiedProfessional: "true", noxAccess: true }],
    ["unknown extra field", { verifiedProfessional: true, noxAccess: true, extra: true }],
  ])("%s", async (_label, body) => {
    renderSignedIn(async () => body);
    await expectDenialOnly();
  });

  it("error", async () => {
    renderSignedIn(() => Promise.reject(new Error("down")));
    await expectDenialOnly();
  });

  it("timeout", async () => {
    renderSignedIn(() => new Promise(() => {}), 40);
    await expectDenialOnly();
  });
});

describe("the shell when access is explicit", () => {
  beforeEach(() => {
    firebaseSignOut.mockReset();
    firebaseSignOut.mockResolvedValue(undefined);
  });

  it("shows the two placeholder tools and they are not links or buttons", async () => {
    renderSignedIn(async () => ({ verifiedProfessional: true, noxAccess: true }));
    expect(
      await screen.findByRole("heading", { level: 1, name: t("dashboard.title") }),
    ).toBeInTheDocument();
    const list = screen.getByTestId("nox-module-list");
    expect(
      screen.getByRole("heading", { level: 2, name: t("modules.assistant.title") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: t("modules.evidence.title") }),
    ).toBeInTheDocument();
    expect(list.querySelector("a, button")).toBeNull();
    expect(screen.queryByRole("heading", { name: t("denied.title") })).toBeNull();
  });

  it("signs out back to the login screen", async () => {
    renderSignedIn(async () => ({ verifiedProfessional: true, noxAccess: true }));
    await screen.findByRole("heading", { level: 2, name: t("modules.assistant.title") });
    await userEvent.click(screen.getByRole("button", { name: t("common.signOut") }));
    expect(firebaseSignOut).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
    expect(screen.queryByTestId("nox-module-list")).toBeNull();
  });
});

describe("signed out", () => {
  beforeEach(() => {
    sendLoginLink.mockReset();
    sendLoginLink.mockResolvedValue(undefined);
  });

  it("shows the magic-link form and no tools", () => {
    render(
      <NoxAuthProvider session="signed-out">
        <Gate />
      </NoxAuthProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: t("login.title") })).toBeInTheDocument();
    expect(screen.getByLabelText(t("login.emailLabel"))).toBeInTheDocument();
    expect(screen.queryByTestId("nox-module-list")).toBeNull();
    expect(screen.queryByRole("heading", { name: t("denied.title") })).toBeNull();
  });

  it("sends the link and confirms without saying who is allowed in", async () => {
    render(
      <NoxAuthProvider session="signed-out">
        <Gate />
      </NoxAuthProvider>,
    );
    await userEvent.type(screen.getByLabelText(t("login.emailLabel")), "person@example.com");
    await userEvent.click(screen.getByRole("button", { name: t("login.sendLink") }));
    expect(sendLoginLink).toHaveBeenCalledWith("person@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent("person@example.com");
  });
});

describe("dev preview", () => {
  it("opens the denial screen from ?preview=denied without a session", async () => {
    window.history.pushState({}, "", "/?preview=denied");
    render(
      <NoxAuthProvider>
        <Gate />
      </NoxAuthProvider>,
    );
    await expectDenialOnly();
  });

  it("opens the shell from ?preview=dashboard without a session", async () => {
    window.history.pushState({}, "", "/?preview=dashboard");
    render(
      <NoxAuthProvider>
        <Gate />
      </NoxAuthProvider>,
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: t("modules.assistant.title") }),
    ).toBeInTheDocument();
  });
});
