import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceConsoleSession } from "../../auth/session-channel.js";
import { ApiRequestError } from "../../lib/api.js";
import type { DriveEdge } from "../../lib/edge.js";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { FakeDriveServer } from "../fake-drive-server.js";
import { resetUnsavedForTests } from "../unsaved.js";
import { DriveScreen } from "./DriveScreen.js";

/**
 * A save goes through the real session: the share read, then the upload, then
 * the commit. These tests expire the session on one of those requests, after
 * the file already exists, and check the editor keeps what was typed.
 */
const ME = "018f0000-0000-7000-8000-0000000000d1";
const PASSPHRASE = "café negro en la guardia de noche";
const DOC_TITLE = "Protocolo vivo";
const DOC_TEXT = "frase que no puede perderse";
const SHEET_TITLE = "Cifras de guardia";
const t = i18n.t.bind(i18n);

class FakeChannel {
  static open: FakeChannel[] = [];
  listeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    FakeChannel.open.push(this);
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener);
  }

  postMessage(data: unknown) {
    for (const other of FakeChannel.open) {
      if (other === this) continue;
      for (const listener of other.listeners) {
        listener(new MessageEvent("message", { data }));
      }
    }
  }

  close() {
    FakeChannel.open = FakeChannel.open.filter((channel) => channel !== this);
  }
}

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

/** ProseMirror measures the caret after a keystroke. jsdom's text nodes have no rects. */
function clientRects() {
  const rect = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    top: 0,
    right: 1,
    bottom: 1,
    left: 0,
    toJSON() {
      return {};
    },
  };
  const list = Object.assign([rect], {
    item: (index: number) => (index === 0 ? rect : null),
  });
  return list as unknown as DOMRectList;
}

beforeEach(() => {
  for (const node of [Element.prototype, Text.prototype, Range.prototype]) {
    Object.defineProperty(node, "getClientRects", {
      configurable: true,
      value: clientRects,
    });
    Object.defineProperty(node, "getBoundingClientRect", {
      configurable: true,
      value: () => clientRects().item(0),
    });
  }
  Document.prototype.elementFromPoint = () => document.body;
  window.scrollBy = () => undefined;
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  FakeChannel.open = [];
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

afterEach(() => {
  resetUnsavedForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type SaveRequest = "share" | "startUpload" | "commit";

/** The next call of one save request fails. Restoring it lets the retry through. */
function failNext(method: SaveRequest, status: number) {
  const edge = holder.edge as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
  const original = edge[method];
  if (!original) throw new Error(`missing ${method}`);
  edge[method] = async () => {
    throw new ApiRequestError(
      status,
      status === 401 ? "UNAUTHENTICATED" : "INTERNAL",
      "save failed",
    );
  };
  return () => {
    edge[method] = original;
  };
}

/**
 * jsdom does not run the sandboxed sheet frame, so a save would wait on a
 * snapshot that never comes. Answer it with the workbook the frame would send.
 * The title the person typed stays in the real editor, outside the frame.
 */
function answerSnapshots(frame: HTMLIFrameElement) {
  const target = frame.contentWindow;
  if (!target) throw new Error("frame window missing");
  Object.defineProperty(target, "postMessage", {
    configurable: true,
    value: (data: unknown) => {
      if (
        data !== null &&
        typeof data === "object" &&
        "t" in data &&
        (data as { t: unknown }).t === "snapshot"
      ) {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              t: "snapshot",
              id: (data as unknown as { id: number }).id,
              sheets: [{ name: "Hoja 1", order: 0, status: 1, celldata: [] }],
            },
            source: target,
          }),
        );
      }
    },
  });
}

async function openEditor(user: ReturnType<typeof userEvent.setup>, kind: "document" | "sheet") {
  renderWithProviders(<DriveScreen />);
  await user.type(
    await screen.findByLabelText(t("drive.setup.passphrase"), {}, { timeout: 5000 }),
    PASSPHRASE,
  );
  await user.type(screen.getByLabelText(t("drive.setup.confirm")), PASSPHRASE);
  await user.click(screen.getByRole("button", { name: t("drive.setup.create") }));
  await screen.findByTestId("recovery-code", {}, { timeout: 15_000 });
  await user.click(screen.getByLabelText(t("drive.recovery.confirm")));
  await user.click(screen.getByRole("button", { name: t("drive.recovery.continue") }));
  await user.click(await screen.findByRole("button", { name: t("drive.new") }));
  await user.click(screen.getByRole("menuitem", { name: t("drive.shares.new") }));
  await user.type(screen.getByLabelText(t("drive.shares.newName")), "Protocolos");
  await user.click(screen.getByRole("button", { name: t("drive.shares.create") }));
  await user.click(
    (await screen.findAllByRole("button", { name: /Protocolos/ }))[0] as HTMLElement,
  );
  await user.click(await screen.findByRole("button", { name: t("drive.new") }));
  await user.click(
    await screen.findByRole("menuitem", {
      name: kind === "document" ? t("drive.doc.new") : t("drive.sheet.new"),
    }),
  );

  if (kind === "document") {
    const title = await screen.findByLabelText(t("drive.doc.title"), {}, { timeout: 20_000 });
    await user.clear(title);
    await user.type(title, DOC_TITLE);
    const body = screen.getByLabelText(t("drive.doc.body"));
    body.focus();
    await user.keyboard(DOC_TEXT);
    return;
  }

  const title = await screen.findByLabelText(t("drive.sheet.title"), {}, { timeout: 20_000 });
  await user.clear(title);
  await user.type(title, SHEET_TITLE);
}

function typedTextIsStillThere(kind: "document" | "sheet") {
  if (kind === "document") {
    expect(screen.getByLabelText(t("drive.doc.title"))).toHaveValue(DOC_TITLE);
    expect(screen.getByText(DOC_TEXT)).toBeVisible();
    return;
  }
  expect(screen.getByLabelText(t("drive.sheet.title"))).toHaveValue(SHEET_TITLE);
}

async function saveNow(user: ReturnType<typeof userEvent.setup>, kind: "document" | "sheet") {
  if (kind === "sheet") {
    answerSnapshots(screen.getByTitle(SHEET_TITLE) as HTMLIFrameElement);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    return;
  }
  await user.click(screen.getByRole("button", { name: t("drive.doc.save") }));
}

async function expiredSave(
  user: ReturnType<typeof userEvent.setup>,
  kind: "document" | "sheet",
  request: SaveRequest,
) {
  await openEditor(user, kind);
  const restore = failNext(request, 401);
  await saveNow(user, kind);
  await waitFor(
    () => {
      expect(screen.getByRole("status")).toHaveTextContent(t("drive.doc.status.expired"));
    },
    { timeout: 20_000 },
  );
  expect(screen.getByRole("alert")).toHaveTextContent(t("drive.sessionExpired"));
  typedTextIsStillThere(kind);
  restore();
  announceConsoleSession();
  await waitFor(
    () => expect(screen.getByRole("status")).toHaveTextContent(t("drive.doc.status.saved")),
    {
      timeout: 20_000,
    },
  );
  typedTextIsStillThere(kind);
}

describe("a Drive save whose first live request finds the session gone", () => {
  const user = () => userEvent.setup({ delay: null });

  it("a document stays open when the share read is 401, and the other tab's session retries the save", async () => {
    await expiredSave(user(), "document", "share");
  }, 90_000);

  it("a document stays open when the upload is 401, and the other tab's session retries the save", async () => {
    await expiredSave(user(), "document", "startUpload");
  }, 90_000);

  it("a document stays open when the commit is 401, and the other tab's session retries the save", async () => {
    await expiredSave(user(), "document", "commit");
  }, 90_000);

  it("a spreadsheet stays open when the share read is 401, and the other tab's session retries the save", async () => {
    await expiredSave(user(), "sheet", "share");
  }, 90_000);

  it("a spreadsheet stays open when the upload is 401, and the other tab's session retries the save", async () => {
    await expiredSave(user(), "sheet", "startUpload");
  }, 90_000);

  it("a spreadsheet stays open when the commit is 401, and the other tab's session retries the save", async () => {
    await expiredSave(user(), "sheet", "commit");
  }, 90_000);

  it("a document keeps the text and shows the generic failure when the share read is not a 401", async () => {
    const typing = user();
    await openEditor(typing, "document");
    const restore = failNext("share", 500);
    await saveNow(typing, "document");
    await waitFor(
      () => {
        expect(screen.getByRole("status")).toHaveTextContent(t("drive.doc.status.error"));
      },
      { timeout: 20_000 },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(t("drive.doc.saveFailed"));
    expect(screen.queryByText(t("drive.sessionExpired"))).toBeNull();
    typedTextIsStillThere("document");
    restore();
  }, 90_000);
});
