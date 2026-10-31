import { api, type Context, locale, type Sheet } from "@fortune-sheet/core";
import { Workbook } from "@fortune-sheet/react";
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import type { FromFrame, ToFrame } from "./frame-protocol.js";
import { SHEET_FONT_SIZE, SHEET_FONTS, type StoredSheet } from "./sheet-format.js";

/**
 * Runs inside the isolated frame, never in the console's own page (see
 * `SheetFrame`): this is the only file allowed to import the spreadsheet engine.
 * It knows the workbook it was handed and nothing else, and it speaks only to
 * the page that opened it.
 */

const send = (message: FromFrame) => window.parent.postMessage(message, "*");

/** The engine keeps its clipboard in session storage, which an opaque origin does not have. */
function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value),
  };
}

/** Links, images and pictures of the sheet need a way out of the frame, so they are not offered. */
const TOOLBAR = [
  "undo",
  "redo",
  "format-painter",
  "clear-format",
  "|",
  "currency-format",
  "percentage-format",
  "number-decrease",
  "number-increase",
  "format",
  "|",
  "font",
  "|",
  "font-size",
  "|",
  "bold",
  "italic",
  "strike-through",
  "underline",
  "|",
  "font-color",
  "background",
  "border",
  "merge-cell",
  "|",
  "horizontal-align",
  "vertical-align",
  "text-wrap",
  "text-rotation",
  "|",
  "freeze",
  "conditionFormat",
  "filter",
  "comment",
  "quick-formula",
  "dataVerification",
  "splitColumn",
  "locationCondition",
  "search",
];

const HEADER_MENU = [
  "copy",
  "paste",
  "|",
  "insert-row",
  "insert-column",
  "delete-row",
  "delete-column",
  "delete-cell",
  "hide-row",
  "hide-column",
  "set-row-height",
  "set-column-width",
  "|",
  "clear",
  "sort",
  "orderAZ",
  "orderZA",
];

const CELL_MENU = [...HEADER_MENU, "filter", "data", "cell-format"];

type Engine = { getAllSheets: () => Sheet[] };

/** The sheets as stored: the sparse cell list instead of the engine's working grid. */
function toStored(sheets: Sheet[]): StoredSheet[] {
  return sheets.map(({ data, ...sheet }) => ({
    ...sheet,
    celldata: data ? api.dataToCelldata(data) : (sheet.celldata ?? []),
  })) as StoredSheet[];
}

function Editor({
  sheets,
  readOnly,
  lang,
  sheetLabel,
  workbook,
}: {
  sheets: StoredSheet[];
  readOnly: boolean;
  lang: string;
  sheetLabel: string;
  workbook: { current: Engine | null };
}) {
  const last = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  // The engine reports a change for every repaint, opening included; only a
  // real difference counts as an edit.
  function changed() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const current = workbook.current;
      if (!current) return;
      const now = JSON.stringify(toStored(current.getAllSheets()));
      if (last.current !== null && last.current !== now) send({ t: "changed" });
      last.current = now;
    }, 300);
  }

  return (
    <Workbook
      ref={(instance) => {
        workbook.current = instance;
      }}
      data={sheets as Sheet[]}
      lang={lang}
      currency="€"
      defaultFontSize={SHEET_FONT_SIZE}
      allowEdit={!readOnly}
      showToolbar={!readOnly}
      showFormulaBar={!readOnly}
      forceCalculation
      toolbarItems={TOOLBAR}
      cellContextMenu={CELL_MENU}
      headerContextMenu={HEADER_MENU}
      hooks={{
        // The engine names a new tab "Sheet2" in every language.
        beforeAddSheet: (sheet) => {
          sheet.name = sheet.name.replace(/^Sheet/, `${sheetLabel} `);
          return true;
        },
      }}
      onChange={changed}
    />
  );
}

/** The engine reads its font menu from the language; ours is the same in every language. */
function setFonts(lang: string) {
  const { fontarray } = locale({ lang } as Context);
  fontarray.splice(0, fontarray.length, ...SHEET_FONTS);
}

function start() {
  Object.defineProperty(window, "sessionStorage", { value: memoryStorage() });
  const workbook: { current: Engine | null } = { current: null };
  const root = createRoot(document.getElementById("root") as HTMLElement);

  window.addEventListener("message", (event: MessageEvent<ToFrame>) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message.t === "open") {
      setFonts(message.lang);
      root.render(
        <Editor
          sheets={message.sheets}
          readOnly={message.readOnly}
          lang={message.lang}
          sheetLabel={message.sheetLabel}
          workbook={workbook}
        />,
      );
    } else if (message.t === "snapshot") {
      const sheets = workbook.current?.getAllSheets() ?? [];
      send({ t: "snapshot", id: message.id, sheets: toStored(sheets) });
    }
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        send({ t: "save" });
      }
    },
    true,
  );

  send({ t: "ready" });
}

start();
