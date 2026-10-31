import { describe, expect, it } from "vitest";
import { isMarkdown, markdownPage, markdownToHtml } from "./markdown.js";

describe("isMarkdown", () => {
  it("recognises a file by its type or by its name, since browsers often send no type", () => {
    expect(isMarkdown("text/markdown", "notas")).toBe(true);
    expect(isMarkdown("application/octet-stream", "Protocolo.MD")).toBe(true);
    expect(isMarkdown(undefined, "guia.markdown")).toBe(true);
    expect(isMarkdown("text/plain", "notas.txt")).toBe(false);
  });
});

describe("markdownToHtml", () => {
  it("renders bold, tables, strikethrough and task lists", async () => {
    const html = await markdownToHtml(
      "**fuerte** ~~no~~\n\n| A | B |\n|---|---|\n| 1 | **2** |\n\n- [x] hecho\n",
    );
    expect(html).toContain("<strong>fuerte</strong>");
    expect(html).toContain("<del>no</del>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td><strong>2</strong></td>");
    expect(html).toContain('type="checkbox"');
  });

  it("keeps a line break inside a table cell", async () => {
    const html = await markdownToHtml("| A |\n|---|\n| uno<br>dos |\n");
    expect(html).toContain("uno<br>dos");
  });

  it("shows raw HTML as text instead of letting it into the page", async () => {
    const html = await markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror="a()">\n');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x");
  });

  it("drops comments", async () => {
    expect(await markdownToHtml("<!-- interno -->\n\nvisible\n")).not.toContain("interno");
  });

  it("keeps only http, https and mail links, opening in a new tab", async () => {
    const html = await markdownToHtml(
      "[a](https://example.com) [b](mailto:x@example.com) [c](javascript:alert(1)) [d](data:text/html,x)",
    );
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('href="mailto:x@example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
  });

  it("never fetches an image: it shows its description", async () => {
    const html = await markdownToHtml("![plano de la sala](https://evil.example/pixel.png)");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<img");
    expect(html).toContain("plano de la sala");
  });
});

describe("markdownPage", () => {
  it("allows no script and no connection in the frame", () => {
    expect(markdownPage("<p>x</p>")).toContain("default-src 'none'; style-src 'unsafe-inline'");
  });
});
