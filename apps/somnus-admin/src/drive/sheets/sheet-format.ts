/**
 * A Drive spreadsheet (owner decision 2026-10-31): a workbook edited in the
 * console, stored in the Drive exactly like any other file -- encrypted in the
 * browser, block by block, before anything is sent. Its bytes are this JSON;
 * the type below is what tells the Drive to open it in the sheet editor.
 *
 * The sheets are the spreadsheet engine's own shape and this side only checks
 * its outline. It never renders them: they go to the isolated frame.
 */
export const SHEET_MIME = "application/vnd.somnus.spreadsheet+json";

/**
 * The font menu, in order: a cell keeps the position in this list, and no font
 * at all means the first. The engine would otherwise start on Times New Roman.
 */
export const SHEET_FONTS = ["Arial", "Calibri", "Times New Roman", "Tahoma", "Verdana"];
export const SHEET_FONT_SIZE = 10;

export type SheetCellValue = {
  v?: string | number | boolean | null;
  m?: string;
  f?: string;
  ct?: { fa?: string; t?: string; s?: Array<{ v?: string }> };
  bl?: number;
  it?: number;
  cl?: number;
  un?: number;
  fs?: number;
  ff?: string | number;
  fc?: string;
  bg?: string;
  ht?: number | string;
  vt?: number | string;
  tb?: string | number;
  mc?: { r: number; c: number; rs?: number; cs?: number };
};

export type SheetCell = { r: number; c: number; v: SheetCellValue | null };

export type SheetBorderSide = { style?: number | string; color?: string } | null;

export type SheetBorder =
  | {
      rangeType: "cell";
      value: {
        row_index: number;
        col_index: number;
        l?: SheetBorderSide;
        r?: SheetBorderSide;
        t?: SheetBorderSide;
        b?: SheetBorderSide;
      };
    }
  | {
      rangeType: "range";
      borderType: string;
      style?: number | string;
      color?: string;
      range: Array<{ row: [number, number]; column: [number, number] }>;
    };

export type SheetConfig = {
  merge?: Record<string, { r: number; c: number; rs: number; cs: number }>;
  rowlen?: Record<string, number>;
  columnlen?: Record<string, number>;
  rowhidden?: Record<string, number>;
  colhidden?: Record<string, number>;
  borderInfo?: SheetBorder[];
};

export type StoredSheet = {
  id?: string;
  name: string;
  order?: number;
  status?: number;
  celldata: SheetCell[];
  config?: SheetConfig;
  frozen?: { type: string; range?: { row_focus?: number; column_focus?: number } };
  [other: string]: unknown;
};

export type SomnusWorkbook = {
  format: "somnus-spreadsheet";
  version: 1;
  sheets: StoredSheet[];
};

export function emptySheets(name: string): StoredSheet[] {
  return [{ name, order: 0, status: 1, celldata: [] }];
}

/**
 * What may be kept of something that claims to be sheets: a list of named
 * sheets with cell lists, or nothing. Used on stored bytes and on whatever the
 * isolated frame sends back, which this side treats as untrusted.
 */
export function cleanSheets(value: unknown): StoredSheet[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sheets: StoredSheet[] = [];
  for (const entry of value as Array<Partial<StoredSheet> | null>) {
    if (typeof entry !== "object" || entry === null) return null;
    if (typeof entry.name !== "string" || !Array.isArray(entry.celldata)) return null;
    sheets.push(entry as StoredSheet);
  }
  return sheets;
}

export function encodeSheets(sheets: StoredSheet[]): Uint8Array {
  const workbook: SomnusWorkbook = { format: "somnus-spreadsheet", version: 1, sheets };
  return new TextEncoder().encode(JSON.stringify(workbook));
}

/** The stored workbook's sheets, or null when the bytes are not a workbook. */
export function decodeSheets(bytes: Uint8Array): StoredSheet[] | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SomnusWorkbook>;
    return parsed.format === "somnus-spreadsheet" ? cleanSheets(parsed.sheets) : null;
  } catch {
    return null;
  }
}
