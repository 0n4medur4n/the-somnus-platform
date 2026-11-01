import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { FileViewer } from "../ui/FileViewer.js";
import { SheetEditor } from "./SheetEditor.js";
import { framePage, SheetFrame, type SheetFrameHandle } from "./SheetFrame.js";
import type { StoredSheet } from "./sheet-format.js";

const t = i18n.t.bind(i18n);
const SHEETS: StoredSheet[] = [{ name: "Uno", order: 0, status: 1, celldata: [] }];

function frameWindow() {
  const frame = screen.getByTitle("Prueba") as HTMLIFrameElement;
  const target = frame.contentWindow as Window;
  const post = vi.spyOn(target, "postMessage");
  const fromFrame = (data: unknown, source: Window | null = target) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source }));
    });
  return { frame, post, fromFrame };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("/* engine */")),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the frame's page", () => {
  it("names one script by hash, so nothing written into the page by a cell can run", async () => {
    const page = await framePage();
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(page)?.[1] ?? "";
    const script = policy.split("; ").find((part) => part.startsWith("script-src")) ?? "";
    expect(script).toMatch(/^script-src 'sha256-[A-Za-z0-9+/=]+' 'unsafe-eval'$/);
    expect(script).not.toContain("unsafe-inline");
  });

  it("the hash is that of the script actually in the page", async () => {
    const page = await framePage();
    const hash = /'sha256-([^']+)'/.exec(page)?.[1];
    const body = /<script>([\s\S]*)<\/script>/.exec(page)?.[1] ?? "";
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    expect(btoa(String.fromCharCode(...new Uint8Array(digest)))).toBe(hash);
  });

  it("can reach nothing outside: no connection, no remote image, font or form", async () => {
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(await framePage())?.[1] ?? "";
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src data: blob:");
    expect(policy).toContain("font-src data:");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toMatch(/connect-src|https?:/);
  });
});

describe("the spreadsheet engine", () => {
  it("is imported by the frame's own entry and by nothing in the console's page", () => {
    const root = join(process.cwd(), "src");
    const sources = (readdirSync(root, { recursive: true }) as string[]).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
    );
    const importers = sources.filter((file) =>
      /from "@fortune-sheet\/(core|react)"/.test(readFileSync(join(root, file), "utf8")),
    );
    expect(importers.map((file) => file.replaceAll("\\", "/"))).toEqual([
      "drive/sheets/frame-entry.tsx",
    ]);
  });
});

describe("SheetFrame", () => {
  const show = (ref?: React.Ref<SheetFrameHandle>, extra?: object) =>
    renderWithProviders(
      <SheetFrame
        ref={ref as React.Ref<SheetFrameHandle>}
        title="Prueba"
        sheets={SHEETS}
        readOnly={false}
        onFailed={vi.fn()}
        {...extra}
      />,
    );

  it("gives the engine scripts and nothing else: never this tab's origin", async () => {
    show();
    const frame = await screen.findByTitle("Prueba");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("allow")).toBeNull();
  });

  it("hands over the engine, then the workbook", async () => {
    show();
    await screen.findByTitle("Prueba");
    const { post, fromFrame } = frameWindow();
    fromFrame({ t: "booted" });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        expect.objectContaining({ t: "engine", js: "/* engine */" }),
        "*",
      ),
    );
    fromFrame({ t: "ready" });
    expect(post).toHaveBeenCalledWith(
      { t: "open", sheets: SHEETS, readOnly: false, lang: "es", sheetLabel: "Hoja" },
      "*",
    );
  });

  it("ignores messages from any other window", async () => {
    const onChanged = vi.fn();
    show(undefined, { onChanged });
    await screen.findByTitle("Prueba");
    const { post, fromFrame } = frameWindow();
    fromFrame({ t: "changed" }, window);
    fromFrame({ t: "ready" }, null);
    expect(onChanged).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores what it does not recognise", async () => {
    show();
    await screen.findByTitle("Prueba");
    const { post, fromFrame } = frameWindow();
    fromFrame(null);
    fromFrame({ t: "exfiltrate" });
    expect(post).not.toHaveBeenCalled();
  });

  it("returns the workbook the frame reports", async () => {
    const ref = createRef<SheetFrameHandle>();
    show(ref);
    await screen.findByTitle("Prueba");
    const { post, fromFrame } = frameWindow();
    const pending = ref.current?.snapshot() as Promise<StoredSheet[]>;
    expect(post).toHaveBeenCalledWith({ t: "snapshot", id: 1 }, "*");
    const sheets = [{ name: "Uno", celldata: [{ r: 0, c: 0, v: { v: 1 } }] }];
    fromFrame({ t: "snapshot", id: 1, sheets });
    await expect(pending).resolves.toEqual(sheets);
  });

  it("refuses a snapshot that is not a workbook, rather than saving it", async () => {
    const ref = createRef<SheetFrameHandle>();
    show(ref);
    await screen.findByTitle("Prueba");
    const { fromFrame } = frameWindow();
    const pending = ref.current?.snapshot() as Promise<StoredSheet[]>;
    fromFrame({ t: "snapshot", id: 1, sheets: "todo mal" });
    await expect(pending).rejects.toThrow();
  });

  it("reports a failure when the engine cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    const onFailed = vi.fn();
    vi.resetModules();
    const { SheetFrame: Fresh } = await import("./SheetFrame.js");
    renderWithProviders(
      <Fresh title="Prueba" sheets={SHEETS} readOnly={false} onFailed={onFailed} />,
    );
    await screen.findByTitle("Prueba");
    frameWindow().fromFrame({ t: "booted" });
    await waitFor(() => expect(onFailed).toHaveBeenCalled());
  });
});

describe("SheetEditor", () => {
  const editor = (onSave = vi.fn(async () => "saved" as const), readOnly = false) => {
    renderWithProviders(
      <SheetEditor
        initialTitle="Prueba"
        initialSheets={SHEETS}
        readOnly={readOnly}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );
    return onSave;
  };

  async function answerSnapshot() {
    const { post, fromFrame } = frameWindow();
    return { post, reply: () => fromFrame({ t: "snapshot", id: 1, sheets: SHEETS }) };
  }

  it("saves when the frame reports Ctrl+S", async () => {
    const onSave = editor();
    await screen.findByTitle("Prueba");
    const { post, reply } = await answerSnapshot();
    frameWindow().fromFrame({ t: "save" });
    await waitFor(() => expect(post).toHaveBeenCalled());
    reply();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Prueba", SHEETS));
    expect(await screen.findByText(t("drive.doc.status.saved"))).toBeInTheDocument();
  });

  it("shows unsaved changes when the frame reports an edit", async () => {
    editor();
    await screen.findByTitle("Prueba");
    frameWindow().fromFrame({ t: "changed" });
    expect(screen.getByText(t("drive.doc.status.dirty"))).toBeInTheDocument();
  });

  it("tells the person when someone else saved first", async () => {
    editor(vi.fn(async () => "conflict" as const) as never);
    await screen.findByTitle("Prueba");
    const { reply } = await answerSnapshot();
    frameWindow().fromFrame({ t: "save" });
    reply();
    expect(await screen.findByText(t("drive.doc.conflict"))).toBeInTheDocument();
  });

  it("offers Excel and CSV, and no save for someone who may only read", async () => {
    const user = userEvent.setup();
    editor(undefined, true);
    expect(screen.queryByRole("button", { name: t("drive.doc.save") })).toBeNull();
    expect(screen.getByText(t("drive.doc.readOnly"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("drive.doc.export.title") }));
    expect(
      screen.getByRole("menuitem", { name: t("drive.sheet.export.xlsx") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("drive.sheet.export.csv") })).toBeInTheDocument();
  });
});

describe("FileViewer", () => {
  const viewer = (name: string, bytes: Uint8Array, mime: string | undefined = undefined) =>
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

  it("renders Markdown in a frame that can run nothing, whatever type the browser gave it", async () => {
    const text = new TextEncoder().encode("# Título\n\n**fuerte**\n");
    viewer("notas.md", text, "application/octet-stream");
    const frame = (await screen.findByTitle("notas.md")) as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("allow-popups allow-popups-to-escape-sandbox");
    expect(frame.getAttribute("srcdoc")).toContain("<strong>fuerte</strong>");
  });

  it("shows a CSV as a spreadsheet, read-only, and offers to edit it", async () => {
    viewer("datos.csv", new TextEncoder().encode("a,b\n"));
    const frame = await screen.findByTitle("datos.csv");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(screen.getByRole("button", { name: t("drive.viewer.editAsSheet") })).toBeInTheDocument();
  });

  it("falls back to no preview when an .xlsx cannot be read", async () => {
    viewer("roto.xlsx", new TextEncoder().encode("esto no es un zip"));
    expect(await screen.findByText(t("drive.preview.noPreview"))).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
  });
});
