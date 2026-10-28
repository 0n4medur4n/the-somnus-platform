import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Gate } from "./App.js";
import { NoxAuthProvider } from "./auth/NoxAuthProvider.js";
import i18n from "./i18n/index.js";
import { NOX_MODULES } from "./modules/registry.js";

const t = (key: string) => i18n.t(key);

const GRANT = { verifiedProfessional: true, noxAccess: true };

function renderGate(reader: (signal: AbortSignal) => Promise<unknown>, timeoutMs?: number) {
  return render(
    <NoxAuthProvider session="signed-in" reader={reader} {...(timeoutMs ? { timeoutMs } : {})}>
      <Gate />
    </NoxAuthProvider>,
  );
}

function expectDenialOnly(): void {
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("denied.title"));
  expect(screen.getByRole("alert")).toHaveTextContent(t("denied.body"));
  expect(screen.queryByTestId("nox-module-list")).toBeNull();
  for (const module of NOX_MODULES) {
    expect(screen.queryByRole("heading", { name: t(module.titleKey) })).toBeNull();
  }
}

describe("without an explicit grant the app renders only the denial screen", () => {
  it.each([
    ["not a verified professional", { verifiedProfessional: false, noxAccess: true }],
    ["no Nox access", { verifiedProfessional: true, noxAccess: false }],
    ["both flags false", { verifiedProfessional: false, noxAccess: false }],
    ["stringly true", { verifiedProfessional: "true", noxAccess: true }],
    ["missing noxAccess", { verifiedProfessional: true }],
    ["unknown grant value", { verifiedProfessional: true, noxAccess: "unknown" }],
    ["empty object", {}],
    ["null body", null],
    ["array body", []],
  ])("%s", async (_label, body) => {
    renderGate(async () => body);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectDenialOnly();
  });

  it("an error shows only the denial screen", async () => {
    renderGate(async () => {
      throw new Error("nox-me-rejected");
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectDenialOnly();
  });

  it("a timeout shows only the denial screen", async () => {
    renderGate(() => new Promise(() => undefined), 20);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expectDenialOnly();
  });

  it("an unknown field does not deny when both grant flags are literal true", async () => {
    renderGate(async () => ({ ...GRANT, role: "professional" }));
    expect(await screen.findByTestId("nox-module-list")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("denied.title") })).toBeNull();
  });

  it("an explicit grant is the only path that shows the tools", async () => {
    renderGate(async () => GRANT);
    expect(await screen.findByTestId("nox-module-list")).toBeInTheDocument();
    for (const module of NOX_MODULES) {
      expect(screen.getByRole("heading", { name: t(module.titleKey) })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: t(module.titleKey) })).toBeNull();
      expect(screen.queryByRole("button", { name: t(module.titleKey) })).toBeNull();
    }
  });
});
