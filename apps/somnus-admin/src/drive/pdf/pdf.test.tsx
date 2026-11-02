import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/utils.js";
import { PdfFrame, pdfFramePage } from "./PdfFrame.js";
import { type PdfTextItem, pageText } from "./pdf-protocol.js";

const item = (str: string, x: number, y: number, width: number, hasEOL = false): PdfTextItem => ({
  str,
  hasEOL,
  transform: [10, 0, 0, 10, x, y],
  width,
});

describe("a PDF page's text", () => {
  it("joins pieces of a word, spaces words apart, and starts a new line with a space", () => {
    const { text, map } = pageText([
      item("Funda", 0, 100, 25),
      item("dores", 25, 100, 25),
      item("del", 60, 100, 15, true),
      item("acuerdo.", 0, 80, 40),
    ]);
    expect(text).toBe("Fundadores del acuerdo.");
    // Every character points back at the piece it came from.
    expect(map[0]).toEqual([0, 0]);
    expect(map[5]).toEqual([1, 0]);
    expect(map[text.indexOf("acuerdo")]).toEqual([3, 0]);
    expect(map).toHaveLength(text.length);
  });

  it("collapses the spaces inside a piece", () => {
    expect(pageText([item("  Pacto   de  Socios ", 0, 0, 100)]).text).toBe("Pacto de Socios");
    expect(pageText([]).text).toBe("");
    expect(pageText([item("\u0000Revisar", 0, 0, 40)]).text).toBe("Revisar");
  });
});

describe("PdfFrame", () => {
  it("lets the viewer run nothing beyond its own boot script, and reach nothing", async () => {
    const page = await pdfFramePage();
    expect(page).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+' 'unsafe-eval'/);
    expect(page).toContain("default-src 'none'");
    expect(page).not.toMatch(/connect-src|https?:\/\//);
  });

  it("keeps the page texts only when they are strings, and fails otherwise", async () => {
    const onPages = vi.fn();
    const onFailed = vi.fn();
    renderWithProviders(
      <PdfFrame
        title="guia.pdf"
        bytes={new Uint8Array([37, 80, 68, 70])}
        goTo={null}
        reading={{ page: null }}
        onPages={onPages}
        onFailed={onFailed}
      />,
    );
    const frame = (await screen.findByTitle("guia.pdf")) as HTMLIFrameElement;
    const source = frame.contentWindow as Window;
    const say = (data: unknown, from: Window | null = source) =>
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data, source: from }));
      });
    say({ t: "pages", texts: ["Una"] }, window);
    expect(onPages).not.toHaveBeenCalled();
    say({ t: "pages", texts: ["Una", 2] });
    expect(onFailed).toHaveBeenCalledTimes(1);
    say({ t: "pages", texts: ["Una", "Dos"] });
    expect(onPages).toHaveBeenCalledWith(["Una", "Dos"]);
  });
});
