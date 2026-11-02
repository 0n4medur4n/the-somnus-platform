import { type Editor, useEditorState } from "@tiptap/react";
import { type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** An A4 page, as the page on screen draws it (297 mm at 96 dpi). */
const A4_HEIGHT_PX = (297 * 96) / 25.4;

/** Words, and sentences (a run of text ending in . ! ? … or the end). */
export function countText(text: string): { words: number; sentences: number } {
  // A word may join with an apostrophe or hyphen; a number keeps its decimals.
  const words =
    text.match(/[\p{L}\p{N}]+(?:(?:['’-]|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const sentences = text
    .split(/[.!?…]+(?=\s|$)|\n+/u)
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  return { words, sentences };
}

/**
 * The counts under the document, as a word processor shows them: words,
 * sentences and pages, and the selection's words when something is selected.
 */
export function DocStats({
  editor,
  page,
}: {
  editor: Editor;
  page: RefObject<HTMLElement | null>;
}) {
  const { t, i18n } = useTranslation();
  const counts = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const whole = countText(e.state.doc.textBetween(0, e.state.doc.content.size, "\n", " "));
      const { from, to, empty } = e.state.selection;
      const selected = empty ? null : countText(e.state.doc.textBetween(from, to, "\n", " ")).words;
      return { ...whole, selected };
    },
  });
  const [pages, setPages] = useState(1);

  useEffect(() => {
    const element = page.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setPages(Math.max(1, Math.ceil((element.offsetHeight - 2) / A4_HEIGHT_PX)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [page]);

  const number = new Intl.NumberFormat(i18n.language);
  return (
    <p
      aria-live="off"
      className="pointer-events-none fixed bottom-4 left-4 z-30 rounded-full border border-white/10 bg-somnus-surface/95 px-3 py-1.5 text-xs text-somnus-subtle shadow-lg"
    >
      {counts.selected !== null
        ? `${t("drive.doc.stats.selected", { count: counts.selected, n: number.format(counts.selected) })} · `
        : null}
      {t("drive.doc.stats.words", { count: counts.words, n: number.format(counts.words) })} ·{" "}
      {t("drive.doc.stats.sentences", {
        count: counts.sentences,
        n: number.format(counts.sentences),
      })}{" "}
      · {t("drive.doc.stats.pages", { count: pages, n: number.format(pages) })}
    </p>
  );
}
