import { getDocument, type PDFDocumentProxy, TextLayer } from "pdfjs-dist";
import * as pdfWorker from "pdfjs-dist/build/pdf.worker.mjs";
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
