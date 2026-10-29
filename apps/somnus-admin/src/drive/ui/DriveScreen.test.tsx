import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../lib/api.js";
import type { DriveEdge } from "../../lib/edge.js";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { FakeDriveServer } from "../fake-drive-server.js";
import { DriveScreen } from "./DriveScreen.js";

/**
 * The Drive screen against the fake server, with real cryptography. The
 * account-missing answer is the worker's real refusal shape: a 404 carrying
 * `drive_account_missing`.
 */
const ME = "018f0000-0000-7000-8000-0000000000d1";

const holder = vi.hoisted(() => ({ edge: null as unknown as DriveEdge }));

vi.mock("../../lib/edge.js", () => ({
  edge: {
    drive: new Proxy(
      {},
      {
        get: (_target, name: string) => (holder.edge as unknown as Record<string, unknown>)[name],
      },
    ),
  },
}));

let server: FakeDriveServer;

beforeEach(() => {
  server = new FakeDriveServer();
  const real = server.edgeFor(ME, "me@thesomnus.com");
  holder.edge = {
    ...real,
    account: async () => {
      try {
        return await real.account();
      } catch {
        throw new ApiRequestError(404, "NOT_FOUND", "missing", "drive_account_missing");
      }
    },
  };
});

const PASSPHRASE = "café negro en la guardia de noche";

async function setUp(user: ReturnType<typeof userEvent.setup>) {
  renderWithProviders(<DriveScreen />);
  await user.type(
    await screen.findByLabelText(i18n.t("drive.setup.passphrase"), {}, { timeout: 5000 }),
    PASSPHRASE,
  );
  await user.type(screen.getByLabelText(i18n.t("drive.setup.confirm")), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: i18n.t("drive.setup.create") }));
  return screen.findByTestId("recovery-code", {}, { timeout: 15_000 });
}

describe("DriveScreen", () => {
  it("first visit: creates the Drive, shows the recovery code once, and enters only after it is saved", async () => {
    const user = userEvent.setup();
    const code = await setUp(user);
    expect(code.textContent).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);

    const enter = screen.getByRole("button", { name: i18n.t("drive.recovery.continue") });
    expect(enter).toBeDisabled();
    await user.click(screen.getByLabelText(i18n.t("drive.recovery.confirm")));
    await user.click(enter);
    expect(await screen.findByText(i18n.t("drive.shares.empty"))).toBeInTheDocument();

    // What reached the server: no passphrase, no recovery code.
    const sent = server.received.join("\n");
    expect(sent).not.toContain(PASSPHRASE);
    expect(sent).not.toContain(code.textContent ?? "missing");
  }, 30_000);

  it("refuses a short or mismatched passphrase before generating anything", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DriveScreen />);
    await user.type(await screen.findByLabelText(i18n.t("drive.setup.passphrase")), "corta");
    await user.type(screen.getByLabelText(i18n.t("drive.setup.confirm")), "corta");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.setup.create") }));
    expect(await screen.findByText(i18n.t("drive.setup.tooShort"))).toBeInTheDocument();
    expect(server.accounts.size).toBe(0);
  });

  it("a returning person unlocks with the passphrase, and a wrong one is refused", async () => {
    const user = userEvent.setup();
    const first = renderWithProviders(<DriveScreen />);
    await user.type(await screen.findByLabelText(i18n.t("drive.setup.passphrase")), PASSPHRASE);
    await user.type(screen.getByLabelText(i18n.t("drive.setup.confirm")), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: i18n.t("drive.setup.create") }));
    await screen.findByTestId("recovery-code", {}, { timeout: 15_000 });
    first.unmount();

    renderWithProviders(<DriveScreen />);
    const field = await screen.findByLabelText(i18n.t("drive.unlock.passphrase"));
    await user.type(field, "no es la frase correcta");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.unlock.open") }));
    expect(
      await screen.findByText(i18n.t("drive.problem.wrong_secret"), {}, { timeout: 15_000 }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(i18n.t("drive.unlock.passphrase")), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: i18n.t("drive.unlock.open") }));
    expect(
      await screen.findByText(i18n.t("drive.shares.empty"), {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
  }, 45_000);

  it("creates a shared folder and an instructions note, decrypted back on screen", async () => {
    const user = userEvent.setup();
    await setUp(user);
    await user.click(screen.getByLabelText(i18n.t("drive.recovery.confirm")));
    await user.click(screen.getByRole("button", { name: i18n.t("drive.recovery.continue") }));

    // "New" -> "New shared folder", named in a dialog.
    await user.click(await screen.findByRole("button", { name: i18n.t("drive.new") }));
    await user.click(screen.getByRole("menuitem", { name: i18n.t("drive.shares.new") }));
    await user.type(screen.getByLabelText(i18n.t("drive.shares.newName")), "Protocolos");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.shares.create") }));
    // The folder appears in the sidebar and on the home grid; either opens it.
    const opens = await screen.findAllByRole("button", { name: /Protocolos/ });
    await user.click(opens[0] as HTMLElement);

    // "New" -> "New note", written in a dialog.
    await user.click(await screen.findByRole("button", { name: i18n.t("drive.new") }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("drive.folder.newNote") }));
    await user.type(screen.getByLabelText(i18n.t("drive.note.title")), "Cómo usar el triaje");
    await user.type(screen.getByLabelText(i18n.t("drive.note.body")), "Paso 1: revisar SAFE-004.");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.note.save") }));

    const note = await screen.findByRole("button", {
      name: `${i18n.t("drive.folder.kind.note")}: Cómo usar el triaje`,
    });
    await user.click(note);
    expect(await screen.findByText("Paso 1: revisar SAFE-004.")).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(i18n.t("drive.folder.verified"))).length).toBeGreaterThan(
      0,
    );

    const sent = server.received.join("\n");
    expect(sent).not.toContain("Protocolos");
    expect(sent).not.toContain("Cómo usar el triaje");
    expect(sent).not.toContain("SAFE-004");
  }, 45_000);

  it("writes a document, saves it encrypted, and reopens it from the folder", async () => {
    const user = userEvent.setup();
    await setUp(user);
    await user.click(screen.getByLabelText(i18n.t("drive.recovery.confirm")));
    await user.click(screen.getByRole("button", { name: i18n.t("drive.recovery.continue") }));
    await user.click(await screen.findByRole("button", { name: i18n.t("drive.new") }));
    await user.click(screen.getByRole("menuitem", { name: i18n.t("drive.shares.new") }));
    await user.type(screen.getByLabelText(i18n.t("drive.shares.newName")), "Protocolos");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.shares.create") }));
    await user.click(
      (await screen.findAllByRole("button", { name: /Protocolos/ }))[0] as HTMLElement,
    );

    // "New" -> "Document" opens the editor straight away.
    await user.click(await screen.findByRole("button", { name: i18n.t("drive.new") }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("drive.doc.new") }));
    const title = await screen.findByLabelText(i18n.t("drive.doc.title"), {}, { timeout: 15_000 });
    await user.clear(title);
    await user.type(title, "Protocolo de guardia");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.doc.save") }));
    expect(
      await screen.findByText(i18n.t("drive.doc.status.saved"), {}, { timeout: 15_000 }),
    ).toBeInTheDocument();

    // Back in the folder, it is a document, and it opens again in the editor.
    await user.click(screen.getByRole("button", { name: i18n.t("drive.doc.back") }));
    const listed = await screen.findByRole(
      "button",
      { name: `${i18n.t("drive.folder.kind.document")}: Protocolo de guardia` },
      { timeout: 15_000 },
    );
    await user.click(listed);
    expect(
      await screen.findByDisplayValue("Protocolo de guardia", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();

    // Nothing readable reached the server.
    expect(server.received.join(" ")).not.toContain("Protocolo de guardia");
  }, 60_000);

  it("copies a link to a note, and the link opens it straight after unlocking", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const first = renderWithProviders(<DriveScreen />);
    await user.type(await screen.findByLabelText(i18n.t("drive.setup.passphrase")), PASSPHRASE);
    await user.type(screen.getByLabelText(i18n.t("drive.setup.confirm")), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: i18n.t("drive.setup.create") }));
    await screen.findByTestId("recovery-code", {}, { timeout: 15_000 });
    await user.click(screen.getByLabelText(i18n.t("drive.recovery.confirm")));
    await user.click(screen.getByRole("button", { name: i18n.t("drive.recovery.continue") }));
    await user.click(await screen.findByRole("button", { name: i18n.t("drive.new") }));
    await user.click(screen.getByRole("menuitem", { name: i18n.t("drive.shares.new") }));
    await user.type(screen.getByLabelText(i18n.t("drive.shares.newName")), "Protocolos");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.shares.create") }));
    await user.click(
      (await screen.findAllByRole("button", { name: /Protocolos/ }))[0] as HTMLElement,
    );
    await user.click(await screen.findByRole("button", { name: i18n.t("drive.new") }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("drive.folder.newNote") }));
    await user.type(screen.getByLabelText(i18n.t("drive.note.title")), "Turno de noche");
    await user.type(screen.getByLabelText(i18n.t("drive.note.body")), "Revisar alarmas a las 3.");
    await user.click(screen.getByRole("button", { name: i18n.t("drive.note.save") }));

    await user.click(
      await screen.findByRole(
        "button",
        { name: i18n.t("drive.actionsFor", { name: "Turno de noche" }) },
        { timeout: 15_000 },
      ),
    );
    await user.click(screen.getByRole("menuitem", { name: i18n.t("drive.link.copy") }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const link = new URL(writeText.mock.calls[0]?.[0] as string);
    expect(link.pathname).toBe("/drive");
    expect(link.searchParams.get("share")).toBeTruthy();
    expect(link.searchParams.get("file")).toBeTruthy();
    // The link carries ids only: never the note's name or text.
    expect(link.toString()).not.toContain("Turno");
    first.unmount();

    // Someone with access opens the link: after unlocking, the note is open.
    renderWithProviders(<DriveScreen />, { route: `${link.pathname}${link.search}` });
    await user.type(await screen.findByLabelText(i18n.t("drive.unlock.passphrase")), PASSPHRASE);
    await user.click(screen.getByRole("button", { name: i18n.t("drive.unlock.open") }));
    expect(
      await screen.findByText("Revisar alarmas a las 3.", {}, { timeout: 15_000 }),
    ).toBeInTheDocument();
  }, 90_000);

  it("never writes anything to browser storage", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await setUp(user);
    await waitFor(() => expect(server.accounts.size).toBe(1));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  }, 30_000);
});
