/**
 * The console speaking to the PDF frame, and the frame speaking back (owner
 * decision 2026-11-02: our own viewer, pdf.js, so a PDF can be read aloud word
 * by word and, later, marked). Pages are numbered from 1.
 */
export type ToFrame =
  | { t: "engine"; js: string; css: string }
  | { t: "open"; data: ArrayBuffer; pageLabel: string }
  /** Scrolls to a page. */
  | { t: "go"; page: number }
  /** Reading aloud: the page being read (null: none) and the word, as offsets in its text. */
  | { t: "read"; page: number | null; start?: number; end?: number };

export type FromFrame =
  | { t: "booted" }
  | { t: "ready" }
  /** Each page's text as a reader hears it, in order. */
  | { t: "pages"; texts: unknown }
  | { t: "failed" };

/** A piece of a page's text, as pdf.js gives it. */
export type PdfTextItem = {
  str: string;
  hasEOL: boolean;
  /** [a, b, c, d, x, y]: font scale in a..d, position in x, y. */
  transform: number[];
  width: number;
};

/**
 * A page's text as a reader hears it, and where each character is: the piece
 * (`[item, char]`) it came from, so a spoken word can be found on the page.
 * Pieces on the same line join without a space unless the gap between them is
 * wider than a fifth of the letter height; a new line always gets one.
 */
export function pageText(items: PdfTextItem[]): { text: string; map: Array<[number, number]> } {
  let text = "";
  const map: Array<[number, number]> = [];
  let pending: [number, number] | null = null;
  let previous: PdfTextItem | null = null;
  items.forEach((item, index) => {
    if (previous && text) {
      const size = Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || 1;
      const sameLine = Math.abs((item.transform[5] ?? 0) - (previous.transform[5] ?? 0)) < size / 2;
      const end = (previous.transform[4] ?? 0) + previous.width;
      const gap = (item.transform[4] ?? 0) - end;
      if (previous.hasEOL || !sameLine || gap > size / 5) pending ??= [index, 0];
    }
    for (let i = 0; i < item.str.length; i++) {
      const char = item.str[i] ?? "";
      // Control characters (a box drawn by a missing glyph) are not read.
      const code = char.charCodeAt(0);
      if (/\s/.test(char) || code < 32 || code === 127) {
        if (text) pending ??= [index, i];
        continue;
      }
      if (pending) {
        text += " ";
        map.push(pending);
        pending = null;
      }
      text += char;
      map.push([index, i]);
    }
    previous = item;
  });
  return { text, map };
}
