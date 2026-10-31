import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContextValue } from "../../auth/AdminAuthContext.js";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { FileViewer } from "../ui/FileViewer.js";
import { DocumentEditor } from "./DocumentEditor.js";
import { toDocx } from "./export.js";

const t = i18n.t.bind(i18n);

vi.mock("../ui/DriveScreen.js", () => ({ DriveScreen: () => <p>drive-screen</p> }));
const { DriveApp } = await import("../../routes/DriveApp.js");

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.restoreAllMocks());

describe("FileViewer", () => {
  const viewer = (name: string, mime: string, bytes: Uint8Array) =>
    renderWithProviders(
      <FileViewer
        name={name}
        mime={mime}
        bytes={bytes}
        canEditAsDocument
        onEditAsDocument={vi.fn()}
        canEditAsSheet
        onEditAsSheet={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
      />,
    );

  it("shows a PDF in the browser's viewer, from this browser's memory", () => {
    viewer("guia.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4"));
    expect(screen.getByTitle("guia.pdf")).toHaveAttribute("src", "blob:preview");
  });

  it("shows a Word file converted to HTML, in a frame that can run nothing", async () => {
    const bytes = new Uint8Array(
      await (
        await toDocx(
          {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Hola Word" }] }],
          },
          "Prueba",
        )
      ).arrayBuffer(),
    );
    viewer(
      "prueba.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes,
    );
    const frame = await screen.findByTitle("prueba.docx", {}, { timeout: 5000 });
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("Hola Word");
    expect(screen.getByRole("button", { name: t("drive.viewer.editAsDocument") })).toBeVisible();
  });
});

describe("DocumentEditor", () => {
  it("saves the title and the content on Ctrl+S, and says so", async () => {
    const onSave = vi.fn().mockResolvedValue("saved");
    renderWithProviders(
      <DocumentEditor
        initialTitle="Protocolo"
        initialContent={{
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Texto inicial" }] }],
        }}
        readOnly={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Texto inicial")).toBeVisible();
    const title = screen.getByLabelText(t("drive.doc.title"));
    await userEvent.clear(title);
    await userEvent.type(title, "Protocolo revisado");
    expect(screen.getByRole("status")).toHaveTextContent(t("drive.doc.status.dirty"));

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedTitle, content] = onSave.mock.calls[0] as [string, { type: string }];
    expect(savedTitle).toBe("Protocolo revisado");
    expect(JSON.stringify(content)).toContain("Texto inicial");
    expect(await screen.findByText(t("drive.doc.status.saved"))).toBeVisible();
  });

  it("says plainly when someone else saved a newer version", async () => {
    const onSave = vi.fn().mockResolvedValue("conflict");
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{ type: "doc", content: [] }}
        readOnly={false}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText(t("drive.doc.title")), " 2");
    await userEvent.click(screen.getByRole("button", { name: t("drive.doc.save") }));
    expect(await screen.findByText(t("drive.doc.conflict"))).toBeVisible();
  });

  it("is read-only for a viewer: no toolbar and no save", () => {
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{ type: "doc", content: [] }}
        readOnly
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: t("drive.doc.save") })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(t("drive.doc.readOnly"));
  });
});

describe("the Drive's own tab", () => {
  const ME = {
    user: {
      id: "018f0000-0000-7000-8000-000000000abc",
      email: "a@thesomnus.com",
      locale: "es" as const,
      status: "active" as const,
    },
    roleKeys: ["support_agent" as const],
    capabilities: ["admin_drive" as const],
  };
  const auth = (state: AdminAuthContextValue["state"]): AdminAuthContextValue => ({
    state,
    refresh: vi.fn(),
    logout: vi.fn(),
  });

  it("opens full window, with a way back to the console, for a holder of admin_drive", () => {
    renderWithProviders(<DriveApp />, { auth: auth({ status: "authorized", me: ME }) });
    expect(screen.getByText("drive-screen")).toBeVisible();
    expect(screen.getByRole("link", { name: t("drive.app.toConsole") })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows nothing of the Drive to anyone without admin_drive", () => {
    renderWithProviders(<DriveApp />, {
      auth: auth({ status: "authorized", me: { ...ME, capabilities: [] } }),
    });
    expect(screen.queryByText("drive-screen")).toBeNull();
    expect(screen.getByText(t("denied.title"))).toBeVisible();
  });
});
