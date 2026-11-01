import css from "@fortune-sheet/react/dist/index.css?inline";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import engineUrl from "./frame-entry.js?worker&url";
import type { FromFrame, ToFrame } from "./frame-protocol.js";
import { cleanSheets, type StoredSheet } from "./sheet-format.js";

export type SheetFrameHandle = {
  /** The workbook as it stands in the frame right now. */
  snapshot: () => Promise<StoredSheet[]>;
};

/**
 * The first thing the frame runs: it waits for the engine, sets it up and hands
 * over. It is the only script the frame's policy names, by hash, so nothing
 * inside a cell (an `onerror`, a `<script>`) can run even if the engine were to
 * write it into the page.
 */
const BOOT = `addEventListener("message",function boot(e){
if(e.source!==parent||!e.data||e.data.t!=="engine")return;
removeEventListener("message",boot);
var s=document.createElement("style");s.textContent=e.data.css;document.head.appendChild(s);
(0,eval)(e.data.js)});
parent.postMessage({t:"booted"},"*");`;

/**
 * The frame's page. The engine needs `unsafe-eval` for a few of its own row
 * operations; everything else is shut. No connection, no remote image or font:
 * whatever happens in there, a workbook cannot leave.
 */
export async function framePage(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(BOOT));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const policy = [
    "default-src 'none'",
    `script-src 'sha256-${hash}' 'unsafe-eval'`,
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>html,body,#root{height:100%;margin:0;background:#fff}</style>
<script>${BOOT}</script></head><body><div id="root"></div></body></html>`;
}

/** A frame that stops answering must not leave the person stuck in the editor. */
const SNAPSHOT_TIMEOUT_MS = 15_000;

let engine: Promise<string> | null = null;

/** The engine's code, once per tab. Vite builds it as one self-contained script. */
function loadEngine(): Promise<string> {
  engine ??= fetch(engineUrl).then((response) => {
    if (!response.ok) throw new Error("Spreadsheet engine unavailable");
    return response.text();
  });
  engine.catch(() => {
    engine = null;
  });
  return engine;
}

/**
 * A workbook on screen, in a frame of its own (owner decision 2026-10-31).
 *
 * The spreadsheet engine writes cell text into the page in places, and this tab
 * holds the keys to the Drive, so the engine never runs here. The frame has
 * `allow-scripts` and nothing else: no `allow-same-origin`, so an opaque origin
 * that reaches no cookie, no storage and no part of this page; no popups, no
 * navigating this tab. It gets the one workbook it shows; messages from it are
 * accepted only from that window and are never treated as anything but data.
 */
export function SheetFrame({
  ref,
  title,
  sheets,
  readOnly,
  onChanged,
  onSaveKey,
  onFailed,
}: {
  ref?: React.Ref<SheetFrameHandle>;
  title: string;
  sheets: StoredSheet[];
  readOnly: boolean;
  onChanged?: () => void;
  onSaveKey?: () => void;
  onFailed: () => void;
}) {
  const { t, i18n } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string | null>(null);
  const waiting = useRef(new Map<number, (value: StoredSheet[] | null) => void>());
  const nextId = useRef(1);
  const latest = useRef({ onChanged, onSaveKey, onFailed, sheets });
  latest.current = { onChanged, onSaveKey, onFailed, sheets };
  const lang = i18n.language.startsWith("en") ? "en" : "es";

  useEffect(() => {
    let cancelled = false;
    framePage().then(
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
    const post = (message: ToFrame) => frame.current?.contentWindow?.postMessage(message, "*");
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
        case "ready":
          post({
            t: "open",
            sheets: latest.current.sheets,
            readOnly,
            lang,
            sheetLabel: t("drive.sheet.sheetLabel"),
          });
          break;
        case "changed":
          latest.current.onChanged?.();
          break;
        case "save":
          latest.current.onSaveKey?.();
          break;
        case "snapshot": {
          const resolve = waiting.current.get(message.id);
          waiting.current.delete(message.id);
          resolve?.(cleanSheets(message.sheets));
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [readOnly, lang, t]);

  useImperativeHandle(ref, () => ({
    snapshot: () =>
      new Promise((resolve, reject) => {
        const target = frame.current?.contentWindow;
        if (!target) {
          reject(new Error("Spreadsheet frame is gone"));
          return;
        }
        const id = nextId.current;
        nextId.current += 1;
        const timer = window.setTimeout(() => {
          waiting.current.delete(id);
          reject(new Error("Spreadsheet frame did not answer"));
        }, SNAPSHOT_TIMEOUT_MS);
        waiting.current.set(id, (value) => {
          window.clearTimeout(timer);
          if (value) resolve(value);
          else reject(new Error("Spreadsheet frame sent no workbook"));
        });
        target.postMessage({ t: "snapshot", id } satisfies ToFrame, "*");
      }),
  }));

  if (!page) return null;
  return (
    <iframe
      ref={frame}
      title={title}
      // Exactly this one token: see above. Adding `allow-same-origin` here
      // would hand the engine this tab's origin, and with it the Drive's keys.
      sandbox="allow-scripts"
      srcDoc={page}
      className="h-full w-full border-0 bg-white"
    />
  );
}
