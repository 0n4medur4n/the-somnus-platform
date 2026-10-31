import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  csvToSheets,
  isCsv,
  isSheetFile,
  isXlsx,
  sheetsToXlsx,
  sheetToCsv,
  XLSX_MIME,
  xlsxToSheets,
} from "./convert.js";
import {
  cleanSheets,
  decodeSheets,
  emptySheets,
  encodeSheets,
  type StoredSheet,
} from "./sheet-format.js";

const cellAt = (sheet: StoredSheet | undefined, r: number, c: number) =>
  sheet?.celldata.find((cell) => cell.r === r && cell.c === c)?.v;

async function reread(blob: Blob): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  return workbook;
}

async function fixture(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.getCell("A1").value = "Concepto";
  sheet.getCell("A1").font = { bold: true, color: { argb: "FFFF0000" }, size: 14 };
  sheet.getCell("A1").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1F4E79" },
  };
  sheet.getCell("B1").value = 10;
  sheet.getCell("B2").value = 32;
  sheet.getCell("B3").value = { formula: "SUM(B1:B2)", result: 42 } as ExcelJS.CellFormulaValue;
  sheet.getCell("C1").value = new Date(Date.UTC(2026, 9, 31));
  sheet.getCell("C1").numFmt = "yyyy-mm-dd";
  sheet.getCell("C2").value = { richText: [{ text: "ri" }, { text: "co" }] };
  sheet.getCell("C3").alignment = { horizontal: "center", wrapText: true };
  sheet.getCell("D1").border = { bottom: { style: "thick", color: { argb: "FF00FF00" } } };
  sheet.mergeCells("E1:F2");
  sheet.getCell("E1").value = "Combinada";
  sheet.getColumn(1).width = 24;
  sheet.getRow(5).height = 30;
  sheet.getCell("A5").value = "alta";
  workbook.addWorksheet("Segunda").getCell("A1").value = "Hola";
  return new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

describe("the stored workbook", () => {
  it("round-trips", () => {
    const sheets: StoredSheet[] = [
      { name: "Uno", order: 0, status: 1, celldata: [{ r: 0, c: 0, v: { v: 1 } }] },
    ];
    expect(decodeSheets(encodeSheets(sheets))).toEqual(sheets);
  });

  it("does not take other bytes for a workbook", () => {
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    expect(decodeSheets(new TextEncoder().encode("no es json"))).toBeNull();
    expect(decodeSheets(bytes({ format: "somnus-document", sheets: emptySheets("a") }))).toBeNull();
    expect(decodeSheets(bytes({ format: "somnus-spreadsheet", sheets: [] }))).toBeNull();
  });

  it("refuses anything from the frame that is not a list of named sheets with cells", () => {
    expect(cleanSheets("nada")).toBeNull();
    expect(cleanSheets([])).toBeNull();
    expect(cleanSheets([null])).toBeNull();
    expect(cleanSheets([{ celldata: [] }])).toBeNull();
    expect(cleanSheets([{ name: "x", celldata: "no" }])).toBeNull();
    expect(cleanSheets([{ name: "x", celldata: [] }])).toHaveLength(1);
  });
});

describe("file types", () => {
  it("recognises spreadsheets by type or by name", () => {
    expect(isXlsx(XLSX_MIME, "x")).toBe(true);
    expect(isXlsx("application/octet-stream", "Datos.XLSX")).toBe(true);
    expect(isCsv("text/csv", "x")).toBe(true);
    expect(isCsv("", "datos.csv")).toBe(true);
    expect(isSheetFile("application/pdf", "a.pdf")).toBe(false);
  });
});

describe("reading .xlsx", () => {
  it("keeps every sheet, in order", async () => {
    const sheets = await xlsxToSheets(await fixture());
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Datos", "Segunda"]);
    expect(sheets[0]?.status).toBe(1);
    expect(sheets[1]?.status).toBe(0);
    expect(cellAt(sheets[1], 0, 0)?.v).toBe("Hola");
  });

  it("keeps values, formulas, dates and rich text", async () => {
    const [sheet] = await xlsxToSheets(await fixture());
    expect(cellAt(sheet, 0, 1)?.v).toBe(10);
    expect(cellAt(sheet, 2, 1)).toMatchObject({ f: "=SUM(B1:B2)", v: 42 });
    expect(cellAt(sheet, 0, 2)).toMatchObject({ ct: { t: "d", fa: "yyyy-mm-dd" } });
    expect(cellAt(sheet, 1, 2)?.v).toBe("rico");
  });

  it("keeps formatting, borders, merges, sizes and frozen rows", async () => {
    const [sheet] = await xlsxToSheets(await fixture());
    expect(cellAt(sheet, 0, 0)).toMatchObject({ bl: 1, fc: "#ff0000", bg: "#1f4e79", fs: 14 });
    expect(cellAt(sheet, 2, 2)).toMatchObject({ ht: 0, tb: "2" });
    expect(sheet?.config?.borderInfo).toContainEqual({
      rangeType: "cell",
      value: { row_index: 0, col_index: 3, b: { style: 13, color: "#00ff00" } },
    });
    expect(sheet?.config?.merge?.["0_4"]).toEqual({ r: 0, c: 4, rs: 2, cs: 2 });
    expect(cellAt(sheet, 0, 4)).toMatchObject({ v: "Combinada", mc: { rs: 2, cs: 2 } });
    expect(cellAt(sheet, 1, 5)?.mc).toEqual({ r: 0, c: 4 });
    expect(sheet?.config?.columnlen?.[0]).toBe(173);
    expect(sheet?.config?.rowlen?.[4]).toBe(40);
    // Rows only: a frozen column here would draw a line through the sheet.
    expect(sheet?.frozen).toEqual({ type: "rangeRow", range: { row_focus: 0, column_focus: -1 } });
  });
});

describe("writing .xlsx", () => {
  const sheet = (overrides: Partial<StoredSheet>): StoredSheet => ({
    name: "Hoja",
    celldata: [],
    ...overrides,
  });

  it("writes a typed number as a number, not as text", async () => {
    const workbook = await reread(
      await sheetsToXlsx([
        sheet({
          celldata: [
            { r: 0, c: 0, v: { v: "5", m: "5", ct: { fa: "General", t: "n" } } },
            { r: 1, c: 0, v: { v: "007", m: "007", ct: { fa: "@", t: "s" } } },
          ],
        }),
      ]),
    );
    expect(workbook.worksheets[0]?.getCell("A1").value).toBe(5);
    expect(workbook.worksheets[0]?.getCell("A2").value).toBe("007");
  });

  it("writes formulas with their last result", async () => {
    const workbook = await reread(
      await sheetsToXlsx([sheet({ celldata: [{ r: 2, c: 0, v: { v: 12, f: "=SUM(A1:A2)" } }] })]),
    );
    expect(workbook.worksheets[0]?.getCell("A3").value).toEqual({
      formula: "SUM(A1:A2)",
      result: 12,
    });
  });

  it("writes the font shown on screen, by its place in the menu when that is what the cell keeps", async () => {
    const workbook = await reread(
      await sheetsToXlsx([
        sheet({
          celldata: [
            { r: 0, c: 0, v: { v: "por defecto" } },
            { r: 1, c: 0, v: { v: "menu", ff: 2, fs: 14 } },
            { r: 2, c: 0, v: { v: "propia", ff: "Georgia", bl: 1, fc: "#ff0000", bg: "#00ff00" } },
          ],
        }),
      ]),
    );
    const first = workbook.worksheets[0];
    expect(first?.getCell("A1").font).toMatchObject({ name: "Arial", size: 10 });
    expect(first?.getCell("A2").font).toMatchObject({ name: "Times New Roman", size: 14 });
    expect(first?.getCell("A3").font).toMatchObject({
      name: "Georgia",
      bold: true,
      color: { argb: "FFFF0000" },
    });
    expect(first?.getCell("A3").fill).toMatchObject({ fgColor: { argb: "FF00FF00" } });
  });

  it("writes rich text as its words", async () => {
    const workbook = await reread(
      await sheetsToXlsx([
        sheet({
          celldata: [{ r: 0, c: 0, v: { ct: { t: "inlineStr", s: [{ v: "ri" }, { v: "co" }] } } }],
        }),
      ]),
    );
    expect(workbook.worksheets[0]?.getCell("A1").value).toBe("rico");
  });

  it("writes merges, sizes, hidden rows and frozen panes", async () => {
    const workbook = await reread(
      await sheetsToXlsx([
        sheet({
          celldata: [
            { r: 0, c: 0, v: { v: "x", mc: { r: 0, c: 0, rs: 2, cs: 2 } } },
            { r: 4, c: 0, v: { v: "oculta" } },
          ],
          config: {
            merge: { "0_0": { r: 0, c: 0, rs: 2, cs: 2 } },
            rowlen: { "3": 40 },
            columnlen: { "2": 173 },
            rowhidden: { "4": 0 },
          },
          frozen: { type: "rangeBoth", range: { row_focus: 0, column_focus: 1 } },
        }),
      ]),
    );
    const first = workbook.worksheets[0];
    expect(first?.getCell("B2").isMerged).toBe(true);
    expect(first?.getRow(4).height).toBe(30);
    expect(first?.getColumn(3).width).toBe(24);
    expect(first?.getRow(5).hidden).toBe(true);
    expect(first?.views[0]).toMatchObject({ state: "frozen", xSplit: 2, ySplit: 1 });
  });

  it("paints range and single-cell borders", async () => {
    const workbook = await reread(
      await sheetsToXlsx([
        sheet({
          config: {
            borderInfo: [
              {
                rangeType: "range",
                borderType: "border-outside",
                style: 1,
                color: "#ff0000",
                range: [{ row: [0, 1], column: [0, 1] }],
              },
              {
                rangeType: "range",
                borderType: "border-horizontal",
                style: 1,
                color: "#000000",
                range: [{ row: [4, 5], column: [0, 0] }],
              },
              {
                rangeType: "cell",
                value: { row_index: 3, col_index: 3, t: { style: 13, color: "#00ff00" } },
              },
            ],
          },
        }),
      ]),
    );
    const first = workbook.worksheets[0];
    expect(first?.getCell("A1").border).toMatchObject({
      left: { style: "thin" },
      top: { style: "thin" },
    });
    expect(first?.getCell("A1").border?.right).toBeUndefined();
    expect(first?.getCell("B2").border).toMatchObject({
      right: { style: "thin" },
      bottom: { style: "thin" },
    });
    expect(first?.getCell("A5").border?.bottom).toMatchObject({ style: "thin" });
    expect(first?.getCell("A5").border?.top).toBeUndefined();
    expect(first?.getCell("D4").border?.top).toMatchObject({ style: "thick" });
  });

  it("makes sheet names Excel accepts: no forbidden characters, 31 at most, none repeated", async () => {
    const workbook = await reread(
      await sheetsToXlsx([
        sheet({ name: "Enero/Febrero: [2026]?", order: 0 }),
        sheet({ name: "x".repeat(40), order: 1 }),
        sheet({ name: "X".repeat(40), order: 2 }),
      ]),
    );
    const names = workbook.worksheets.map((worksheet) => worksheet.name);
    expect(names[0]).toBe("Enero Febrero   2026");
    expect(names[1]).toHaveLength(31);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(3);
  });

  it("puts sheets in their tab order", async () => {
    const workbook = await reread(
      await sheetsToXlsx([sheet({ name: "b", order: 1 }), sheet({ name: "a", order: 0 })]),
    );
    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual(["a", "b"]);
  });

  it("survives a round trip through .xlsx", async () => {
    const first = await xlsxToSheets(await fixture());
    const blob = await sheetsToXlsx(first);
    const again = await xlsxToSheets(new Uint8Array(await blob.arrayBuffer()));
    expect(cellAt(again[0], 2, 1)?.f).toBe("=SUM(B1:B2)");
    expect(cellAt(again[0], 0, 0)).toMatchObject({ bl: 1, bg: "#1f4e79" });
    expect(again[0]?.config?.merge?.["0_4"]).toEqual({ r: 0, c: 4, rs: 2, cs: 2 });
    expect(again.map((sheet) => sheet.name)).toEqual(["Datos", "Segunda"]);
  });
});

describe("CSV", () => {
  const rows = (text: string) =>
    csvToSheets(text, "datos.csv")[0]?.celldata.map((cell) => [cell.r, cell.c, cell.v?.v]);

  it("reads commas, and numbers as numbers", () => {
    expect(rows("a,b\n1,2.5\n")).toEqual([
      [0, 0, "a"],
      [0, 1, "b"],
      [1, 0, 1],
      [1, 1, 2.5],
    ]);
  });

  it("reads the semicolons of a Spanish Excel, and tabs", () => {
    expect(rows("a;b,c\r\n")).toEqual([
      [0, 0, "a"],
      [0, 1, "b,c"],
    ]);
    expect(rows("a\tb\n")).toEqual([
      [0, 0, "a"],
      [0, 1, "b"],
    ]);
  });

  it("reads quotes that hold separators, line breaks and quotes", () => {
    expect(rows('"a,b","di ""hola""\nadiós"\n')).toEqual([
      [0, 0, "a,b"],
      [0, 1, 'di "hola"\nadiós'],
    ]);
  });

  it("skips a byte order mark and names the sheet after the file", () => {
    const [sheet] = csvToSheets("﻿a\n", "datos.csv");
    expect(cellAt(sheet, 0, 0)?.v).toBe("a");
    expect(sheet?.name).toBe("datos");
  });

  it("keeps a decimal comma as text rather than splitting the cell", () => {
    expect(rows("1,5;2,5\n")).toEqual([
      [0, 0, "1,5"],
      [0, 1, "2,5"],
    ]);
  });

  it("keeps anything that is not plainly a number as text", () => {
    expect(rows("12.5.1\n")).toEqual([[0, 0, "12.5.1"]]);
  });

  it("writes what is on screen, quoted where needed, with a mark Excel reads as UTF-8", () => {
    const sheet: StoredSheet = {
      name: "x",
      celldata: [
        { r: 0, c: 0, v: { v: 0.5, m: "50%" } },
        { r: 0, c: 2, v: { v: "a;b" } },
        { r: 2, c: 0, v: { ct: { s: [{ v: 'di "hola"' }] } } },
      ],
    };
    expect(sheetToCsv(sheet, ";")).toBe('﻿50%;;"a;b"\r\n\r\n"di ""hola"""\r\n');
  });
});
