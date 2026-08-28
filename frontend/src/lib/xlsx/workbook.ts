/**
 * Turn sheet specs plus data into one .xlsx, and read one back.
 *
 * exceljs is imported dynamically, the way `xlsxRoundTrip.ts` already does it,
 * so ~900 kB of spreadsheet machinery stays out of the bundle until someone
 * actually exports.
 */

import type { CellKind, ColumnSpec, SheetSpec } from "./sheetSpec";

const HEADER_FILL = "FF1F2937";
const HEADER_FONT = "FFF1F5F9";
const HINT_FONT = "FF94A3B8";
const LOCKED_FONT = "FF94A3B8";

/** Excel's own date mask. Chosen unambiguous on purpose: a German reader and
 *  an American one must not read 03.04. as two different days. */
const DATE_FORMAT = "yyyy-mm-dd";
const DATETIME_FORMAT = "yyyy-mm-dd hh:mm";

/** One sheet plus the rows that go in it, type-tied so a spec cannot be
 *  paired with the wrong data. */
export interface SheetData<T> {
  spec: SheetSpec<T>;
  rows: readonly T[];
}

/**
 * A sheet erased of its type, so sheets for different domains can travel in
 * one array. The pairing is checked at the call site by `sheet()` below.
 */
export type AnySheetData = {
  spec: SheetSpec<never>;
  rows: readonly never[];
};

/** Type-safe constructor for the erased pair above. */
export function sheet<T>(spec: SheetSpec<T>, rows: readonly T[]): AnySheetData {
  return { spec, rows } as unknown as AnySheetData;
}

/**
 * Make a translated string usable as a worksheet name.
 *
 * Excel refuses `* ? : \ / [ ]` outright and truncates past 31 characters, and
 * exceljs throws rather than fixing it up. The name comes from a translation
 * file, so this is not a hypothetical: a translator writing "Orte / Besuche"
 * would break the export for that language only, and every test would stay
 * green because the tests read English keys.
 *
 * Names are also deduplicated, since two long names can collide once cut to 31.
 */
export function safeSheetName(raw: string, taken: Set<string>): string {
  let name = raw.replace(/[*?:\\/[\]]/g, "-").trim() || "Sheet";
  if (name.length > 31) name = name.slice(0, 31).trim();

  if (!taken.has(name)) {
    taken.add(name);
    return name;
  }
  for (let i = 2; i < 100; i++) {
    const suffix = ` (${i})`;
    const candidate = name.slice(0, 31 - suffix.length).trim() + suffix;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  taken.add(name);
  return name;
}

function toCell(kind: CellKind, raw: string | number | boolean | Date | null): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (kind) {
    case "number":
      return typeof raw === "number" ? raw : Number(raw);
    case "boolean":
      return Boolean(raw);
    case "date":
    case "datetime": {
      // Dates arrive as ISO strings from the API. A real Excel date cell is
      // what makes Excel's own date filters and sorting work — a string looks
      // identical and behaves like text.
      const d = raw instanceof Date ? raw : new Date(String(raw));
      return Number.isNaN(d.getTime()) ? String(raw) : d;
    }
    default:
      return String(raw);
  }
}

function numberFormatFor(kind: CellKind): string | undefined {
  if (kind === "date") return DATE_FORMAT;
  if (kind === "datetime") return DATETIME_FORMAT;
  return undefined;
}

/**
 * Build the workbook.
 *
 * Layout per sheet: an optional hint line, then the header row, then data.
 * The header row is frozen and given an autofilter, because a sheet of 300
 * flights is unusable without either.
 */
export async function buildWorkbook(sheets: AnySheetData[]): Promise<import("exceljs").Workbook> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TravStats";
  wb.created = new Date();

  const taken = new Set<string>();
  for (const { spec, rows } of sheets) {
    const columns = spec.columns as unknown as ColumnSpec<unknown>[];
    const ws = wb.addWorksheet(safeSheetName(spec.name, taken), {
      views: [{ state: "frozen", ySplit: spec.hint ? 2 : 1 }],
    });

    if (spec.hint) {
      const hintRow = ws.addRow([spec.hint]);
      hintRow.font = { italic: true, size: 9, color: { argb: HINT_FONT } };
      ws.mergeCells(hintRow.number, 1, hintRow.number, Math.max(1, columns.length));
    }

    const header = ws.addRow(columns.map((c) => c.header));
    header.font = { bold: true, color: { argb: HEADER_FONT } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    header.height = 20;

    ws.columns = columns.map((c) => ({ width: c.width ?? 16 }));

    for (const row of rows) {
      const values = columns.map((c) => toCell(c.kind, c.value(row)));
      const added = ws.addRow(values);
      columns.forEach((c, i) => {
        const cell = added.getCell(i + 1);
        const fmt = numberFormatFor(c.kind);
        if (fmt) cell.numFmt = fmt;
        if (c.locked) {
          cell.font = { color: { argb: LOCKED_FONT } };
          cell.protection = { locked: true };
        }
      });
    }

    ws.autoFilter = {
      from: { row: header.number, column: 1 },
      to: { row: header.number, column: Math.max(1, columns.length) },
    };
  }

  return wb;
}

/** The finished file, ready to hand to a download. */
export async function buildWorkbookBlob(sheets: AnySheetData[]): Promise<Blob> {
  const wb = await buildWorkbook(sheets);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** One parsed sheet: the spec key it matched, and its rows as raw strings
 *  keyed by column key. Interpretation is the importer's job, not the
 *  reader's — this only undoes the spreadsheet, not the domain. */
export interface ParsedSheet {
  key: string;
  rows: Record<string, string>[];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // exceljs wraps rich text and formula results; both carry the readable
    // form in a known field.
    const o = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return String(o.result);
    return "";
  }
  return String(value);
}

/**
 * Read a workbook back into rows, matching sheets to the given specs.
 *
 * Sheets are matched **by name**, and columns **by header text**, because that
 * is all a file carries — the machine keys live only here. A sheet the specs
 * do not know is skipped rather than rejected: someone may well add a notes
 * tab of their own, and throwing the whole import away over it would be
 * hostile.
 */
export async function parseWorkbook(
  file: ArrayBuffer,
  specs: SheetSpec<never>[],
): Promise<ParsedSheet[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file);

  const out: ParsedSheet[] = [];

  // The reader must look for the name the WRITER produced, not the raw
  // translation — otherwise a sanitised or truncated tab is invisible on
  // re-import. Same sequence, same Set, same results.
  const taken = new Set<string>();
  for (const spec of specs) {
    const ws = wb.getWorksheet(safeSheetName(spec.name, taken));
    if (!ws) continue;

    const columns = spec.columns as unknown as ColumnSpec<unknown>[];
    // Find the header row: the first row whose cells match the spec headers.
    // Not a fixed number, because the hint line is optional and a user may
    // have inserted a row above it.
    let headerRowNumber = 0;
    const wanted = new Set(columns.map((c) => c.header));
    ws.eachRow((row, rowNumber) => {
      if (headerRowNumber) return;
      const texts = (row.values as unknown[]).slice(1).map(cellToString);
      const hits = texts.filter((t) => wanted.has(t)).length;
      if (hits >= Math.min(2, columns.length)) headerRowNumber = rowNumber;
    });
    if (!headerRowNumber) continue;

    // header text -> spec key, so a reordered or partly deleted set of
    // columns still lands in the right fields.
    const headerRow = ws.getRow(headerRowNumber);
    const indexToKey = new Map<number, string>();
    (headerRow.values as unknown[]).forEach((raw, index) => {
      if (index === 0) return;
      const text = cellToString(raw);
      const col = columns.find((c) => c.header === text);
      if (col) indexToKey.set(index, col.key);
    });

    const rows: Record<string, string>[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const record: Record<string, string> = {};
      let hasAny = false;
      indexToKey.forEach((key, index) => {
        const text = cellToString(row.getCell(index).value).trim();
        record[key] = text;
        if (text) hasAny = true;
      });
      // A blank line in the middle of a sheet is formatting, not a record —
      // importing it would create an empty row.
      if (hasAny) rows.push(record);
    });

    out.push({ key: spec.key, rows });
  }

  return out;
}
