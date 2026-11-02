import { getDocument, type PDFDocumentProxy, TextLayer } from "pdfjs-dist";
import * as pdfWorker from "pdfjs-dist/build/pdf.worker.mjs";
import { MARK_COLORS } from "../notes/notes-format.js";
import { type FromFrame, type PdfTextItem, pageText, type ToFrame } from "./pdf-protocol.js";

/**
 * The PDF viewer, inside its own frame (owner decision 2026-11-02). It runs
 * only here: `sandbox="allow-scripts"` and nothing else, an opaque origin with
 * no connection, because a PDF is a file someone else made and pdf.js parses
 * it. It gets the one PDF it shows and sends back only page texts.
 *
 * pdf.js runs its parser in this same thread (no Worker): the worker's code is
 * bundled here and handed over as `pdfjsWorker`, which pdf.js uses when set.
 */
(globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = pdfWorker;

const tell = (message: FromFrame) => parent.postMessage(message, "*");

type Page = {
  box: HTMLDivElement;
  textLayer: TextLayer | null;
  /** Set once drawing starts; settles when the text layer is on the page. */
  drawn: Promise<void> | null;
  map: Array<[number, number]>;
};

const pages: Page[] = [];
let pdf: PDFDocumentProxy | null = null;
let reading: Page | null = null;
let phrases: Extract<ToFrame, { t: "phrases" }>["marks"] = [];
let canMark = false;
let picked: { index: number; start: number; end: number } | null = null;

type Highlights = Map<string, unknown>;
const highlights = (): Highlights | undefined =>
  (globalThis as unknown as { CSS?: { highlights?: Highlights } }).CSS?.highlights;
const HighlightClass = () =>
  (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;

/** A range over a page's text layer, from offsets in the page's text. */
function rangeOf(page: Page, start: number, end: number): Range | null {
  const first = page.map[start];
  const last = page.map[end - 1];
  const divs = page.textLayer?.textDivs ?? [];
  const from = first && divs[first[0]]?.firstChild;
  const to = last && divs[last[0]]?.firstChild;
  if (!first || !last || !from || !to) return null;
  const range = document.createRange();
  range.setStart(from, Math.min(first[1], from.textContent?.length ?? 0));
  range.setEnd(to, Math.min(last[1] + 1, to.textContent?.length ?? 0));
  return range;
}

/** Marked phrases on the pages drawn so far, one highlight per colour. */
function paint() {
  const registry = highlights();
  if (!registry) return;
  const byColor = new Map<string, Range[]>();
  for (const mark of phrases) {
    const page = pages[mark.index];
    const range = page?.textLayer ? rangeOf(page, mark.start, mark.end) : null;
    if (range) byColor.set(mark.color, [...(byColor.get(mark.color) ?? []), range]);
  }
  for (const color of MARK_COLORS) {
    const ranges = byColor.get(color);
    if (ranges) registry.set(`somnus-c-${color}`, new (HighlightClass())(...ranges));
    else registry.delete(`somnus-c-${color}`);
  }
}

// The bar that marks or comments on a selection, shown above it.
const bar = document.createElement("div");
bar.id = "somnus-tools";
bar.setAttribute("role", "toolbar");
document.body.append(bar);

/** The selection, as offsets in one page's text; null if it spans pages. */
function chosen(): { index: number; start: number; end: number; rect: DOMRect } | null {
  const selection = getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const element = (node: Node) => (node instanceof Element ? node : node.parentElement);
  const box = element(range.startContainer)?.closest(".page");
  if (!box || box !== element(range.endContainer)?.closest(".page")) return null;
  const index = pages.findIndex((page) => page.box === box);
  const page = pages[index];
  const divs = page?.textLayer?.textDivs ?? [];
  if (!page) return null;
  let start = -1;
  let end = -1;
  page.map.forEach(([item, char], k) => {
    const node = divs[item]?.firstChild;
    if (!node) return;
    if (range.comparePoint(node, char) === 0 && range.comparePoint(node, char + 1) === 0) {
      if (start < 0) start = k;
      end = k + 1;
    }
  });
  return start < 0 ? null : { index, start, end, rect: range.getBoundingClientRect() };
}

function send(color: string, comment: boolean) {
  if (!picked) return;
  tell({ t: "select", ...picked, color, comment });
  picked = null;
  bar.style.display = "none";
  getSelection()?.removeAllRanges();
}

document.addEventListener("mousedown", (event) => {
  if (!bar.contains(event.target as Node)) bar.style.display = "none";
});
document.addEventListener("mouseup", (event) => {
  if (bar.contains(event.target as Node)) return;
  setTimeout(() => {
    const choice = canMark ? chosen() : null;
    picked = choice && { index: choice.index, start: choice.start, end: choice.end };
    if (!choice) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "flex";
    bar.style.top = `${Math.max(scrollY + 4, scrollY + choice.rect.top - bar.offsetHeight - 8)}px`;
    bar.style.left = `${Math.max(8, Math.min(scrollX + choice.rect.left, innerWidth - bar.offsetWidth - 8))}px`;
  }, 0);
});

const root = document.getElementById("root") as HTMLElement;
root.className = "somnus-pdf";

function render(page: Page, number: number): Promise<void> {
  page.drawn ??= draw(page, number).catch(() => {});
  return page.drawn;
}

async function draw(page: Page, number: number) {
  if (!pdf) return;
  const proxy = await pdf.getPage(number);
  const scale = page.box.clientWidth / proxy.getViewport({ scale: 1 }).width;
  // The text layer sizes itself from these, to sit exactly over the drawing.
  page.box.style.setProperty("--scale-factor", String(scale));
  page.box.style.setProperty("--total-scale-factor", String(scale));
  const viewport = proxy.getViewport({ scale });
  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  page.box.append(canvas);
  await proxy.render({
    canvas,
    viewport,
    ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }),
  }).promise;
  const layer = document.createElement("div");
  layer.className = "textLayer";
  page.box.append(layer);
  page.textLayer = new TextLayer({
    textContentSource: await proxy.getTextContent(),
    container: layer,
    viewport,
  });
  await page.textLayer.render();
  paint();
}

/** The word being read, highlighted without touching the page's text. */
function mark(page: Page, start?: number, end?: number) {
  const highlights = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS
    ?.highlights;
  if (!highlights) return;
  const first = start === undefined ? undefined : page.map[start];
  const last = end === undefined ? undefined : page.map[end - 1];
  const divs = page.textLayer?.textDivs ?? [];
  const from = first && divs[first[0]]?.firstChild;
  const to = last && divs[last[0]]?.firstChild;
  if (!first || !last || !from || !to) {
    highlights.delete("somnus-word");
    return;
  }
  const range = document.createRange();
  range.setStart(from, Math.min(first[1], from.textContent?.length ?? 0));
  range.setEnd(to, Math.min(last[1] + 1, to.textContent?.length ?? 0));
  const Highlight = (globalThis as unknown as { Highlight: new (r: Range) => unknown }).Highlight;
  highlights.set("somnus-word", new Highlight(range));
  const rect = range.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > innerHeight) {
    scrollBy({ top: rect.top - innerHeight / 2, behavior: "smooth" });
  }
}

async function open(data: ArrayBuffer, pageLabel: string) {
  pdf = await getDocument({
    data: new Uint8Array(data),
    // The file is the only input: no form script in it runs, nothing is fetched.
    // (pdf.js 6 no longer compiles anything from a PDF, so there is no eval to turn off.)
    enableXfa: false,
    useSystemFonts: true,
    stopAtErrors: false,
  }).promise;
  const watcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const number = Number((entry.target as HTMLElement).dataset["page"]);
        const page = pages[number - 1];
        if (page) void render(page, number);
      }
    },
    { rootMargin: "800px 0px" },
  );
  const texts: string[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const proxy = await pdf.getPage(number);
    const { width, height } = proxy.getViewport({ scale: 1 });
    const box = document.createElement("div");
    box.className = "page";
    box.dataset["page"] = String(number);
    box.setAttribute("aria-label", `${pageLabel} ${number}`);
    box.style.aspectRatio = `${width} / ${height}`;
    root.append(box);
    box.style.setProperty("--user-unit", "1");
    box.style.setProperty("--scale-round-x", "1px");
    box.style.setProperty("--scale-round-y", "1px");
    const content = await proxy.getTextContent();
    const items = content.items.filter((item): item is PdfTextItem & typeof item => "str" in item);
    const heard = pageText(items as PdfTextItem[]);
    pages.push({ box, textLayer: null, drawn: null, map: heard.map });
    texts.push(heard.text);
    watcher.observe(box);
  }
  tell({ t: "pages", texts });
}

addEventListener("message", (event: MessageEvent<ToFrame>) => {
  if (event.source !== parent) return;
  const message = event.data;
  if (message?.t === "open") {
    open(message.data, message.pageLabel).catch(() => tell({ t: "failed" }));
  } else if (message?.t === "phrases") {
    if (!bar.childNodes.length) {
      for (const color of MARK_COLORS) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = `somnus-dot somnus-dot-${color}`;
        dot.setAttribute("aria-label", String(message.labels.colors[color] ?? color));
        dot.addEventListener("click", () => send(color, false));
        bar.append(dot);
      }
      const talk = document.createElement("button");
      talk.type = "button";
      talk.className = "somnus-comment";
      talk.textContent = String(message.labels.comment);
      talk.addEventListener("click", () => send("yellow", true));
      bar.append(talk);
    }
    canMark = true;
    phrases = Array.isArray(message.marks) ? message.marks : [];
    paint();
  } else if (message?.t === "go") {
    pages[message.page - 1]?.box.scrollIntoView({ block: "start" });
  } else if (message?.t === "read") {
    const page = message.page === null ? null : (pages[message.page - 1] ?? null);
    if (page !== reading) {
      reading?.box.classList.remove("somnus-reading");
      page?.box.classList.add("somnus-reading");
      reading = page;
    }
    if (!page) {
      mark({ box: root as HTMLDivElement, textLayer: null, drawn: null, map: [] });
      return;
    }
    const number = (message.page ?? 1) as number;
    if (!page.drawn) page.box.scrollIntoView({ block: "start" });
    void render(page, number).then(() => mark(page, message.start, message.end));
  }
});

tell({ t: "ready" });
