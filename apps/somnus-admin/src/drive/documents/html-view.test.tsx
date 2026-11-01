import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { FileViewer } from "../ui/FileViewer.js";
import { htmlViewerPage, isHtml } from "./html-view.js";

const t = i18n.t.bind(i18n);

/** The holder page, parsed the way a browser would, without running anything. */
const parse = (page: string) => new DOMParser().parseFromString(page, "text/html");

describe("isHtml", () => {
  it("recognises a page by its type or by its name, since browsers often send no type", () => {
    expect(isHtml("text/html", "x")).toBe(true);
    expect(isHtml("", "Motor.HTML")).toBe(true);
    expect(isHtml("application/octet-stream", "motor.htm")).toBe(true);
    expect(isHtml("text/plain", "notas.txt")).toBe(false);
    expect(isHtml(undefined, undefined)).toBe(false);
  });
});

describe("htmlViewerPage", () => {
  const hostile = `"></iframe><script>alert(document.domain)</script><img src=x onerror=a()>`;

  it("puts the file in a frame with scripts and nothing else: never the console's origin", () => {
    const frames = parse(htmlViewerPage("a.html", "<p>hola</p>")).querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frames[0]?.getAttribute("srcdoc")).toBe("<p>hola</p>");
  });

  it("may write to the clipboard, for a page's own copy button, and never read it", () => {
    const frame = parse(htmlViewerPage("a.html", "x")).querySelector("iframe");
    expect(frame?.getAttribute("allow")).toBe("clipboard-write");
  });

  it("states its policy before anything else that could load", () => {
    const head = parse(htmlViewerPage("a.html", "x")).head;
    const policy = head.querySelector('meta[http-equiv="Content-Security-Policy"]');
    const content = policy?.getAttribute("content") ?? "";
    expect(content).toContain("default-src 'none'");
    expect(content).toContain("base-uri 'none'");
    expect(content).toContain("form-action 'none'");
    expect(content).not.toMatch(/connect-src|frame-src|https?:|\*/);
    expect(content).toMatch(/img-src data: blob:(;|$)/);
  });

  it("has no script of its own, because in a tab it carries the console's origin", () => {
    expect(parse(htmlViewerPage("a.html", "<script>1</script>")).scripts).toHaveLength(0);
  });

  it("cannot be broken out of by the file", () => {
    const doc = parse(htmlViewerPage("a.html", hostile));
    expect(doc.scripts).toHaveLength(0);
    expect(doc.images).toHaveLength(0);
    expect(doc.querySelector("iframe")?.getAttribute("srcdoc")).toBe(hostile);
  });

  it("cannot be broken out of by the file's name", () => {
    const doc = parse(htmlViewerPage(hostile, "x"));
    expect(doc.scripts).toHaveLength(0);
    expect(doc.images).toHaveLength(0);
    expect(doc.querySelectorAll("iframe")).toHaveLength(1);
    expect(doc.title).toBe(hostile);
  });
});

describe("FileViewer with an HTML file", () => {
  const SOURCE = "<!doctype html><title>t</title><script>document.title='x'</script><p>hola</p>";
  let open: ReturnType<typeof vi.fn>;
  let created: Blob[];

  const viewer = (name = "motor.html", mime = "") =>
    renderWithProviders(
      <FileViewer
        name={name}
        mime={mime}
        bytes={new TextEncoder().encode(SOURCE)}
        canEditAsDocument
        onEditAsDocument={vi.fn()}
        canEditAsSheet
        onEditAsSheet={vi.fn()}
        onDownload={vi.fn()}
        onClose={vi.fn()}
      />,
    );

  beforeEach(() => {
    created = [];
    open = vi.fn();
    vi.stubGlobal("open", open);
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        created.push(blob);
        return "blob:pagina";
      }),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows it in the viewer, sandboxed twice over", async () => {
    viewer();
    const frame = await screen.findByTitle("motor.html");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    const inner = parse(frame.getAttribute("srcdoc") ?? "").querySelector("iframe");
    expect(inner?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(inner?.getAttribute("srcdoc")).toBe(SOURCE);
  });

  it("opens the same sandboxed page in a tab that cannot reach this one", async () => {
    const user = userEvent.setup();
    viewer();
    await user.click(await screen.findByRole("button", { name: t("drive.viewer.openInTab") }));
    expect(open).toHaveBeenCalledWith("blob:pagina", "_blank", "noopener");
    const page = await (created[0] as Blob).text();
    expect(parse(page).querySelector("iframe")?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(parse(page).scripts).toHaveLength(0);
    expect((created[0] as Blob).type).toBe("text/html;charset=utf-8");
  });

  it("makes one copy however many tabs are opened, and takes it back on closing", async () => {
    const user = userEvent.setup();
    const { unmount } = viewer();
    const button = await screen.findByRole("button", { name: t("drive.viewer.openInTab") });
    await user.click(button);
    await user.click(button);
    expect(created).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pagina"));
  });

  it("offers a tab only for pages", async () => {
    viewer("notas.txt", "text/plain");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: t("drive.viewer.openInTab") })).toBeNull();
  });
});
