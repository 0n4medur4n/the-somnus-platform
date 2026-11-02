import css from "pdfjs-dist/web/pdf_viewer.css?inline";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import engineUrl from "./pdf-frame-entry.js?worker&url";
import type { FromFrame, ToFrame } from "./pdf-protocol.js";

/**
 * The first thing the frame runs: it waits for the viewer, sets it up and
 * hands over. It is the only script the frame's policy names, by hash.
 */
const BOOT = `addEventListener("message",function boot(e){
if(e.source!==parent||!e.data||e.data.t!=="engine")return;
removeEventListener("message",boot);
var s=document.createElement("style");s.textContent=e.data.css;document.head.appendChild(s);
(0,eval)(e.data.js)});
parent.postMessage({t:"booted"},"*");`;

/** Pages on a grey desk, the page being read outlined, the spoken word in blue. */
const PAGE_STYLE = `html,body{margin:0;background:#e8eaed}
.somnus-pdf{padding:12px 0 96px}
.somnus-pdf .page{position:relative;width:min(100% - 24px,900px);margin:0 auto 12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.somnus-pdf .page.somnus-reading{outline:3px solid #437ef7;outline-offset:2px}
::highlight(somnus-word){background-color:rgba(67,126,247,.45)}`;

/**
 * The page. pdf.js needs `unsafe-eval` only to start (the viewer arrives as
 * text); it is told not to compile anything from the PDF. Everything else is
 * shut: no connection, no remote image or font, so a PDF cannot call home.
 */
export async function pdfFramePage(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BOOT));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${hash}' 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>${PAGE_STYLE}</style>
<script>${BOOT}</script></head><body><div id="root"></div></body></html>`;
}

let engine: Promise<string> | null = null;

/** The viewer's code, once per tab. Vite builds it as one self-contained script. */
function loadEngine(): Promise<string> {
  engine ??= fetch(engineUrl).then((response) => {
    if (!response.ok) throw new Error("PDF viewer unavailable");
    return response.text();
  });
  engine.catch(() => {
    engine = null;
  });
  return engine;
}

/**
 * A PDF on screen, in a frame of its own (owner decision 2026-11-02): pdf.js
 * parses files other people made, and this tab holds the Drive's keys, so it
 * never runs here. `allow-scripts` and nothing else, like the spreadsheet: an
 * opaque origin that reaches no cookie, no storage and no part of this page.
 * It gets the one PDF it shows; what comes back is page texts, kept only if
 * they are strings, one per page.
 */
export function PdfFrame({
  title,
  bytes,
  goTo,
  reading,
  onPages,
  onFailed,
}: {
  title: string;
  bytes: Uint8Array;
  /** Scrolls to a page; a new `nonce` repeats the same page. */
  goTo: { page: number; nonce: number } | null;
  /** The page being read aloud, and the word, as offsets in its text. */
  reading: { page: number | null; start?: number; end?: number };
  onPages: (texts: string[]) => void;
  onFailed: () => void;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const latest = useRef({ bytes, onPages, onFailed, label: t("drive.viewer.page") });
  latest.current = { bytes, onPages, onFailed, label: t("drive.viewer.page") };

  useEffect(() => {
    let cancelled = false;
    pdfFramePage().then(
      (html) => {
        if (!cancelled) setPage(html);
      },
      () => latest.current.onFailed(),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const post = (message: ToFrame, transfer: Transferable[] = []) =>
      frame.current?.contentWindow?.postMessage(message, "*", transfer);
    const onMessage = (event: MessageEvent<FromFrame>) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data;
      switch (message?.t) {
        case "booted":
          loadEngine().then(
            (js) => post({ t: "engine", js, css }),
            () => latest.current.onFailed(),
          );
          break;
        case "ready": {
          // A copy: the frame takes ownership of what it is sent.
          const data = latest.current.bytes.slice().buffer;
          post({ t: "open", data, pageLabel: latest.current.label }, [data]);
          break;
        }
        case "pages": {
          const texts = Array.isArray(message.texts) ? message.texts : [];
          if (texts.length > 0 && texts.every((text) => typeof text === "string")) {
            setPageCount(texts.length);
            latest.current.onPages(texts as string[]);
          } else latest.current.onFailed();
          break;
        }
        case "failed":
          latest.current.onFailed();
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (pageCount === null || !goTo || goTo.page < 1 || goTo.page > pageCount) return;
    frame.current?.contentWindow?.postMessage({ t: "go", page: goTo.page } satisfies ToFrame, "*");
  }, [pageCount, goTo]);

  useEffect(() => {
    if (pageCount === null) return;
    const valid = reading.page !== null && reading.page >= 1 && reading.page <= pageCount;
    const message: ToFrame = {
      t: "read",
      page: valid ? reading.page : null,
      ...(valid && reading.start !== undefined ? { start: reading.start } : {}),
      ...(valid && reading.end !== undefined ? { end: reading.end } : {}),
    };
    frame.current?.contentWindow?.postMessage(message, "*");
  }, [pageCount, reading]);

  if (!page) return null;
  return (
    <iframe
      ref={frame}
      title={title}
      // Exactly this one token: adding `allow-same-origin` would hand pdf.js
      // this tab's origin, and with it the Drive's keys.
      sandbox="allow-scripts"
      srcDoc={page}
      className="h-full w-full border-0 bg-[#e8eaed]"
    />
  );
}
