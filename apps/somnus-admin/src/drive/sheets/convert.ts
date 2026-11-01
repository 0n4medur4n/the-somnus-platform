import {
  SHEET_FONT_SIZE,
  SHEET_FONTS,
  type SheetBorder,
  type SheetBorderSide,
  type SheetCell,
  type SheetCellValue,
  type SheetConfig,
  type StoredSheet,
} from "./sheet-format.js";

/**
 * Spreadsheets in and out of the formats people send each other. Everything
 * happens in this browser, from the decrypted workbook: nothing is sent anywhere
 * to be converted. The Excel reader and writer are loaded only when needed.
 */
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const SHEET_EXPORTS = ["xlsx", "csv"] as const;
export type SheetExport = (typeof SHEET_EXPORTS)[number];

export function isXlsx(mime: string | undefined, name: string | undefined): boolean {
  return mime === XLSX_MIME || (name ?? "").toLowerCase().endsWith(".xlsx");
}

export function isCsv(mime: string | undefined, name: string | undefined): boolean {
  return mime === "text/csv" || (name ?? "").toLowerCase().endsWith(".csv");
}

/** True for a file the sheet viewer can show. */
export function isSheetFile(mime: string | undefined, name: string | undefined): boolean {
  return isXlsx(mime, name) || isCsv(mime, name);
}

type ExcelModule = typeof import("exceljs");
type ExcelCell = import("exceljs").Cell;
type ExcelWorksheet = import("exceljs").Worksheet;
type ExcelBorderSide = import("exceljs").Border;
type ExcelBorders = import("exceljs").Borders;
type ExcelFont = import("exceljs").Font;

async function excel(): Promise<ExcelModule> {
  const module = await import("exceljs");
  return (module as unknown as { default?: ExcelModule }).default ?? module;
}

// --- cells ---

/** Excel's serial day number for a date, which is how the engine stores one. */
function dateToSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

function plainCell(value: string | number | boolean): SheetCellValue {
  if (typeof value === "number") {
    return { v: value, m: String(value), ct: { fa: "General", t: "n" } };
  }
  if (typeof value === "boolean") {
    const shown = value ? "TRUE" : "FALSE";
    return { v: shown, m: shown, ct: { fa: "General", t: "b" } };
  }
  return { v: value, m: value, ct: { fa: "General", t: "g" } };
}

function hexOf(color: { argb?: string } | undefined): string | undefined {
  const argb = color?.argb;
  return argb && /^[0-9a-f]{8}$/i.test(argb) ? `#${argb.slice(2).toLowerCase()}` : undefined;
}

function argbOf(hex: string | undefined): string | undefined {
  const match = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  return match ? `FF${match[1]?.toUpperCase()}` : undefined;
}

const H_ALIGN_IN: Record<string, number> = { center: 0, left: 1, right: 2 };
const V_ALIGN_IN: Record<string, number> = { middle: 0, top: 1, bottom: 2 };
const H_ALIGN_OUT = ["center", "left", "right"] as const;
const V_ALIGN_OUT = ["middle", "top", "bottom"] as const;

/** Excel's border styles, by the engine's number for them. */
const BORDER_OUT: Record<string, import("exceljs").BorderStyle> = {
  "1": "thin",
  "2": "hair",
  "3": "dotted",
  "4": "dashed",
  "5": "dashDot",
  "6": "dashDotDot",
  "7": "double",
  "8": "medium",
  "9": "mediumDashed",
  "10": "mediumDashDot",
  "11": "mediumDashDotDot",
  "12": "slantDashDot",
  "13": "thick",
};
const BORDER_IN: Record<string, number> = Object.fromEntries(
  Object.entries(BORDER_OUT).map(([key, value]) => [value, Number(key)]),
);

function cellValue(cell: ExcelCell): SheetCellValue | null {
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return cell.numFmt ? { v: value, ct: { fa: cell.numFmt, t: "n" } } : plainCell(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return plainCell(value);
  if (value instanceof Date) {
    const fa = cell.numFmt && /[ymdh]/i.test(cell.numFmt) ? cell.numFmt : "yyyy-MM-dd";
    return { v: dateToSerial(value), ct: { fa, t: "d" } };
  }
  if ("formula" in value || "sharedFormula" in value) {
    const result = value.result;
    const shown = typeof result === "string" || typeof result === "number" ? result : undefined;
    return {
      ...(shown === undefined ? {} : plainCell(shown)),
      ...(cell.formula ? { f: `=${cell.formula}` } : {}),
    };
  }
  if ("richText" in value) return plainCell(value.richText.map((part) => part.text).join(""));
  if ("hyperlink" in value) return plainCell(String(value.text ?? value.hyperlink));
  if ("error" in value) return plainCell(String(value.error));
  return null;
}

function cellStyle(cell: ExcelCell): Partial<SheetCellValue> {
  const style: Partial<SheetCellValue> = {};
  const font = cell.font;
  if (font?.bold) style.bl = 1;
  if (font?.italic) style.it = 1;
  if (font?.strike) style.cl = 1;
  if (font?.underline) style.un = 1;
  if (font?.size) style.fs = font.size;
  if (font?.name) style.ff = font.name;
  const color = hexOf(font?.color);
  if (color) style.fc = color;
  const fill = cell.fill;
  if (fill?.type === "pattern" && fill.pattern !== "none") {
    const background = hexOf(fill.fgColor);
    if (background) style.bg = background;
  }
  const align = cell.alignment;
  const horizontal = H_ALIGN_IN[align?.horizontal ?? ""];
  if (horizontal !== undefined) style.ht = horizontal;
  const vertical = V_ALIGN_IN[align?.vertical ?? ""];
  if (vertical !== undefined) style.vt = vertical;
  if (align?.wrapText) style.tb = "2";
  return style;
}

function borderSide(side: Partial<ExcelBorderSide> | undefined): SheetBorderSide | undefined {
  const style = BORDER_IN[side?.style ?? ""];
  return style ? { style, color: hexOf(side?.color) ?? "#000000" } : undefined;
}

function cellBorder(cell: ExcelCell, r: number, c: number): SheetBorder | null {
  const left = borderSide(cell.border?.left);
  const right = borderSide(cell.border?.right);
  const top = borderSide(cell.border?.top);
  const bottom = borderSide(cell.border?.bottom);
  if (!left && !right && !top && !bottom) return null;
  return {
    rangeType: "cell",
    value: {
      row_index: r,
      col_index: c,
      ...(left ? { l: left } : {}),
      ...(right ? { r: right } : {}),
      ...(top ? { t: top } : {}),
      ...(bottom ? { b: bottom } : {}),
    },
  };
}

function parseRange(range: string): { r1: number; c1: number; r2: number; c2: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(range);
  if (!match) return null;
  const column = (letters: string) =>
    [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const [, a = "", b = "", c = a, d = b] = match;
  return { c1: column(a), r1: Number(b) - 1, c2: column(c), r2: Number(d) - 1 };
}

function readSheet(worksheet: ExcelWorksheet, order: number): StoredSheet {
  const celldata: SheetCell[] = [];
  const rowlen: Record<string, number> = {};
  const columnlen: Record<string, number> = {};
  const rowhidden: Record<string, number> = {};
  const colhidden: Record<string, number> = {};
  const merged: NonNullable<SheetConfig["merge"]> = {};
  const borders: SheetBorder[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const r = rowNumber - 1;
    if (row.height) rowlen[r] = Math.round((row.height * 4) / 3);
    if (row.hidden) rowhidden[r] = 0;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const c = columnNumber - 1;
      if (cell.isMerged && cell.master !== cell) return;
      const border = cellBorder(cell, r, c);
      if (border) borders.push(border);
      const value = cellValue(cell);
      const style = cellStyle(cell);
      if (value || Object.keys(style).length > 0) {
        celldata.push({ r, c, v: { ...value, ...style } });
      }
    });
  });

  for (let c = 1; c <= worksheet.columnCount; c += 1) {
    const column = worksheet.getColumn(c);
    if (column.width) columnlen[c - 1] = Math.round(column.width * 7 + 5);
    if (column.hidden) colhidden[c - 1] = 0;
  }

  const merges = (worksheet.model as unknown as { merges?: string[] }).merges ?? [];
  for (const merge of merges) {
    const range = parseRange(merge);
    if (!range) continue;
    const { r1, c1, r2, c2 } = range;
    const info = { r: r1, c: c1, rs: r2 - r1 + 1, cs: c2 - c1 + 1 };
    merged[`${r1}_${c1}`] = info;
    const master = celldata.find((cell) => cell.r === r1 && cell.c === c1);
    if (master) master.v = { ...master.v, mc: info };
    else celldata.push({ r: r1, c: c1, v: { mc: info } });
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        if (r !== r1 || c !== c1) celldata.push({ r, c, v: { mc: { r: r1, c: c1 } } });
      }
    }
  }

  const view = worksheet.views?.find((v) => v.state === "frozen") as
    | { xSplit?: number; ySplit?: number }
    | undefined;
  const xSplit = view?.xSplit ?? 0;
  const ySplit = view?.ySplit ?? 0;

  return {
    name: worksheet.name,
    order,
    status: order === 0 ? 1 : 0,
    row: Math.max(84, worksheet.rowCount + 20),
    column: Math.max(26, worksheet.columnCount + 5),
    celldata,
    config: { rowlen, columnlen, rowhidden, colhidden, merge: merged, borderInfo: borders },
    ...(xSplit || ySplit
      ? {
          frozen: {
            // Rows only must say so: "both" would freeze a column as well.
            type: xSplit && ySplit ? "rangeBoth" : ySplit ? "rangeRow" : "rangeColumn",
            range: { row_focus: ySplit - 1, column_focus: xSplit - 1 },
          },
        }
      : {}),
  };
}

/** A .xlsx as sheets: values, formulas, formatting, merges, sizes and frozen panes. */
export async function xlsxToSheets(bytes: Uint8Array): Promise<StoredSheet[]> {
  const { Workbook } = await excel();
  const workbook = new Workbook();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await workbook.xlsx.load(buffer as ArrayBuffer);
  const sheets = workbook.worksheets.map((worksheet, order) => readSheet(worksheet, order));
  if (sheets.length === 0) throw new Error("Workbook has no sheets");
  return sheets;
}

/** The cell's value for Excel: the engine keeps a typed number as text. */
function typedValue(value: SheetCellValue): SheetCellValue["v"] {
  const inline = value.ct?.s?.map((part) => part.v ?? "").join("");
  const raw = inline ?? value.v;
  const numeric = value.ct?.t === "n" || value.ct?.t === "d";
  return numeric && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
}

function fontName(ff: SheetCellValue["ff"]): string {
  if (typeof ff === "string" && !/^\d+$/.test(ff)) return ff;
  return SHEET_FONTS[Number(ff ?? 0)] ?? (SHEET_FONTS[0] as string);
}

function writeCell(cell: ExcelCell, value: SheetCellValue) {
  const raw = typedValue(value);
  if (value.f) {
    cell.value = {
      formula: value.f.replace(/^=/, ""),
      result: typeof raw === "boolean" ? undefined : (raw ?? undefined),
    } as ExcelCell["value"];
  } else if (raw !== undefined && raw !== null) {
    cell.value = raw;
  }
  const format = value.ct?.fa;
  if (format && format !== "General" && format !== "@") cell.numFmt = format;

  const color = argbOf(value.fc);
  const font: Partial<ExcelFont> = {
    ...(value.bl ? { bold: true } : {}),
    ...(value.it ? { italic: true } : {}),
    ...(value.cl ? { strike: true } : {}),
    ...(value.un ? { underline: true } : {}),
    size: Number(value.fs ?? SHEET_FONT_SIZE),
    name: fontName(value.ff),
    ...(color ? { color: { argb: color } } : {}),
  };
  cell.font = font;
  const background = argbOf(value.bg);
  if (background) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: background } };
  }
  const horizontal = value.ht === undefined ? undefined : H_ALIGN_OUT[Number(value.ht)];
  const vertical = value.vt === undefined ? undefined : V_ALIGN_OUT[Number(value.vt)];
  const wrap = String(value.tb) === "2";
  if (horizontal || vertical || wrap) {
    cell.alignment = {
      ...(horizontal ? { horizontal } : {}),
      ...(vertical ? { vertical } : {}),
      ...(wrap ? { wrapText: true } : {}),
    };
  }
}

function excelSide(
  style: number | string | undefined,
  color: string | undefined,
): Partial<ExcelBorderSide> | undefined {
  const name = BORDER_OUT[String(style)];
  return name ? { style: name, color: { argb: argbOf(color) ?? "FF000000" } } : undefined;
}

/** Which sides of the cell at (r, c) a range border of `type` paints. */
function rangeSides(
  type: string,
  r: number,
  c: number,
  range: { row: [number, number]; column: [number, number] },
) {
  const [r1, r2] = range.row;
  const [c1, c2] = range.column;
  const all = type === "border-all";
  const outside = type === "border-outside";
  return {
    left:
      all ||
      ((outside || type === "border-left") && c === c1) ||
      (type === "border-vertical" && c > c1),
    right:
      all ||
      ((outside || type === "border-right") && c === c2) ||
      (type === "border-vertical" && c < c2),
    top:
      all ||
      ((outside || type === "border-top") && r === r1) ||
      (type === "border-horizontal" && r > r1),
    bottom:
      all ||
      ((outside || type === "border-bottom") && r === r2) ||
      (type === "border-horizontal" && r < r2),
  };
}

function writeBorders(worksheet: ExcelWorksheet, borders: SheetBorder[]) {
  const paint = (r: number, c: number, sides: Partial<ExcelBorders>) => {
    const cell = worksheet.getCell(r + 1, c + 1);
    cell.border = { ...cell.border, ...sides };
  };
  for (const border of borders) {
    if (border.rangeType === "cell") {
      const { row_index: r, col_index: c, l, r: right, t, b } = border.value;
      const left = excelSide(l?.style, l?.color);
      const rightSide = excelSide(right?.style, right?.color);
      const top = excelSide(t?.style, t?.color);
      const bottom = excelSide(b?.style, b?.color);
      paint(r, c, {
        ...(left ? { left } : {}),
        ...(rightSide ? { right: rightSide } : {}),
        ...(top ? { top } : {}),
        ...(bottom ? { bottom } : {}),
      } as Partial<ExcelBorders>);
      continue;
    }
    const line = excelSide(border.style, border.color);
    if (!line) continue;
    for (const range of border.range) {
      for (let r = range.row[0]; r <= range.row[1]; r += 1) {
        for (let c = range.column[0]; c <= range.column[1]; c += 1) {
          const on = rangeSides(border.borderType, r, c, range);
          paint(r, c, {
            ...(on.left ? { left: line } : {}),
            ...(on.right ? { right: line } : {}),
            ...(on.top ? { top: line } : {}),
            ...(on.bottom ? { bottom: line } : {}),
          } as Partial<ExcelBorders>);
        }
      }
    }
  }
}

/** Excel refuses these characters in a sheet's name, and more than 31 of any. */
function excelSheetName(name: string, taken: Set<string>): string {
  const base =
    name
      .replace(/[*?:\\/[\]]/g, " ")
      .trim()
      .slice(0, 31) || "Hoja";
  let unique = base;
  for (let n = 2; taken.has(unique.toLowerCase()); n += 1) {
    unique = `${base.slice(0, 28)} ${n}`;
  }
  taken.add(unique.toLowerCase());
  return unique;
}

export async function sheetsToXlsx(sheets: StoredSheet[]): Promise<Blob> {
  const { Workbook } = await excel();
  const workbook = new Workbook();
  const taken = new Set<string>();
  const ordered = [...sheets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const sheet of ordered) {
    const frozenRow = sheet.frozen?.range?.row_focus ?? -1;
    const frozenColumn = sheet.frozen?.range?.column_focus ?? -1;
    const worksheet = workbook.addWorksheet(excelSheetName(sheet.name, taken), {
      views:
        frozenRow >= 0 || frozenColumn >= 0
          ? [{ state: "frozen", xSplit: frozenColumn + 1, ySplit: frozenRow + 1 }]
          : [],
    });
    for (const cell of sheet.celldata) {
      if (cell.v) writeCell(worksheet.getCell(cell.r + 1, cell.c + 1), cell.v);
    }
    const config = sheet.config ?? {};
    for (const [r, height] of Object.entries(config.rowlen ?? {})) {
      worksheet.getRow(Number(r) + 1).height = (height * 3) / 4;
    }
    for (const [c, width] of Object.entries(config.columnlen ?? {})) {
      worksheet.getColumn(Number(c) + 1).width = Math.max((width - 5) / 7, 1);
    }
    for (const r of Object.keys(config.rowhidden ?? {})) {
      worksheet.getRow(Number(r) + 1).hidden = true;
    }
    for (const c of Object.keys(config.colhidden ?? {})) {
      worksheet.getColumn(Number(c) + 1).hidden = true;
    }
    for (const { r, c, rs, cs } of Object.values(config.merge ?? {})) {
      worksheet.mergeCells(r + 1, c + 1, r + rs, c + cs);
    }
    writeBorders(worksheet, config.borderInfo ?? []);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as ArrayBuffer], { type: XLSX_MIME });
}

// --- CSV ---

/**
 * The separator of the first line. A semicolon decides it: Excel in Spanish
 * writes them, and its decimal commas (`1,5;2,5`) are not separators.
 */
function detectSeparator(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  if (line.includes(";")) return ";";
  return line.includes("\t") ? "\t" : ",";
}

/** RFC 4180 rows: quotes may hold separators, line breaks and doubled quotes. */
function parseCsv(text: string): string[][] {
  const separator = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === separator) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function csvToSheets(text: string, name: string): StoredSheet[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const celldata: SheetCell[] = [];
  rows.forEach((row, r) => {
    row.forEach((field, c) => {
      if (field === "") return;
      const number = /^-?\d+(\.\d+)?$/.test(field) ? Number(field) : null;
      celldata.push({ r, c, v: plainCell(number ?? field) });
    });
  });
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return [
    {
      name: name.replace(/\.csv$/i, "").slice(0, 31),
      order: 0,
      status: 1,
      row: Math.max(84, rows.length + 20),
      column: Math.max(26, width + 5),
      celldata,
    },
  ];
}

/** One sheet as CSV, as shown on screen; Excel needs the BOM to read it as UTF-8. */
export function sheetToCsv(sheet: StoredSheet, separator: string): string {
  const rows: string[][] = [];
  for (const { r, c, v } of sheet.celldata) {
    const shown = v?.ct?.s?.map((part) => part.v ?? "").join("") ?? v?.m ?? v?.v;
    if (shown === undefined || shown === null || shown === "") continue;
    const row = rows[r] ?? [];
    row[c] = String(shown);
    rows[r] = row;
  }
  const lines = Array.from(rows, (row = []) =>
    Array.from(row, (field = "") =>
      field.includes(separator) || /["\r\n]/.test(field)
        ? `"${field.replaceAll('"', '""')}"`
        : field,
    ).join(separator),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}
