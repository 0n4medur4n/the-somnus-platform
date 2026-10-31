import type { StoredSheet } from "./sheet-format.js";

/** The console speaking to the frame that holds the spreadsheet engine. */
export type ToFrame =
  | { t: "engine"; js: string; css: string }
  | { t: "open"; sheets: StoredSheet[]; readOnly: boolean; lang: string; sheetLabel: string }
  | { t: "snapshot"; id: number };

/** The frame speaking back. Never trusted: see `SheetFrame`. */
export type FromFrame =
  | { t: "booted" }
  | { t: "ready" }
  | { t: "changed" }
  | { t: "save" }
  | { t: "snapshot"; id: number; sheets: unknown };
