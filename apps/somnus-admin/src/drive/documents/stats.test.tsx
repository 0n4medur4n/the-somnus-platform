import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { i18n, renderWithProviders } from "../../test/utils.js";
import { countText } from "./DocStats.js";
import { DocumentEditor } from "./DocumentEditor.js";

describe("counting a document", () => {
  it("counts words and sentences as a reader would", () => {
    expect(countText("Un sol rotundo, iluminaba aquel vergel. ¿Y el jardín? ¡Sí!")).toEqual({
      words: 10,
      sentences: 3,
    });
    // Numbers, contractions and hyphenated words are one word each; a decimal ends nothing.
    expect(countText("Pagó 3.5 euros al co-fundador")).toEqual({ words: 5, sentences: 1 });
    expect(countText("Título\nPrimer párrafo")).toEqual({ words: 3, sentences: 2 });
    expect(countText("   ")).toEqual({ words: 0, sentences: 0 });
  });

  it("shows words, sentences and pages under the document", () => {
    renderWithProviders(
      <DocumentEditor
        initialTitle="Doc"
        initialContent={{
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Hola equipo. Adiós." }] },
          ],
        }}
        readOnly={false}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const t = i18n.t.bind(i18n);
    expect(
      screen.getByText(new RegExp(t("drive.doc.stats.words", { count: 3, n: "3" }))),
    ).toBeVisible();
    expect(
      screen.getByText(new RegExp(t("drive.doc.stats.sentences", { count: 2, n: "2" }))),
    ).toBeVisible();
    expect(
      screen.getByText(new RegExp(t("drive.doc.stats.pages", { count: 1, n: "1" }))),
    ).toBeVisible();
  });
});
