import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceConsoleSession } from "../auth/session-channel.js";
import { i18n, renderWithProviders } from "../test/utils.js";
import { DocumentEditor, type SaveOutcome } from "./documents/DocumentEditor.js";
import type { DocExtras } from "./documents/doc-format.js";
import { resetUnsavedForTests } from "./unsaved.js";

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

function editor(
  onSave: (title: string, content: JSONContent, extras: DocExtras) => Promise<SaveOutcome>,
) {
  return renderWithProviders(
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
}

async function saveWith(outcome: "expired" | "error") {
  const onSave = vi.fn(
    async (_title: string, _content: JSONContent, _extras: DocExtras) => outcome,
  );
  editor(onSave);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  return onSave;
}

describe("a Drive save when the session has expired", () => {
  afterEach(() => {
    resetUnsavedForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the editor and the text, and offers a retry", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const onSave = await saveWith("expired");
    expect(screen.getByText("Texto inicial")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(t("drive.sessionExpired"));
    const leaving = new Event("beforeunload", { cancelable: true });
    const preventLeave = vi.spyOn(leaving, "preventDefault");
    window.dispatchEvent(leaving);
    expect(preventLeave).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: t("drive.sessionExpiredRetry") }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("warns before leaving while the save is in error", async () => {
    await saveWith("error");
    expect(await screen.findByRole("alert")).toHaveTextContent(t("drive.doc.saveFailed"));
    const event = new Event("beforeunload", { cancelable: true });
    const prevent = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(prevent).toHaveBeenCalled();
    expect(screen.getByText("Texto inicial")).toBeVisible();
  });

  it("retries the pending save exactly once when another tab creates a session", async () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    FakeChannel.open = [];
    const onSave = await saveWith("expired");
    announceConsoleSession();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenCalledTimes(2);
  });
});
