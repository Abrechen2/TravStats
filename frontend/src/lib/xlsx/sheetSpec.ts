/**
 * What a worksheet is, independent of which domain fills it.
 *
 * The workbook is a readable projection of the database: one sheet per table,
 * column A always the row's id. That id is what makes the file re-importable
 * — a row that comes back carrying one updates the record it names, a row
 * without one is new. Everything else in this module exists to keep those two
 * halves, writer and reader, described in ONE place per sheet so they cannot
 * drift into disagreeing about a column.
 *
 * The pre-existing single-sheet flight exporter (`lib/xlsxRoundTrip.ts`) set
 * this contract; this generalises it rather than replacing it, so the flight
 * sheet keeps the exact shape and id semantics it already had.
 */

/** How a value is written into a cell — drives both format and parsing. */
export type CellKind = "text" | "number" | "date" | "datetime" | "boolean";

export interface ColumnSpec<T> {
  /** Stable machine key. Used as the header comment anchor and by the parser. */
  key: string;
  /** Human column heading, already translated. */
  header: string;
  kind: CellKind;
  /** Column width in Excel character units. */
  width?: number;
  /** Pull the cell value out of one record. Return null for an empty cell. */
  value: (row: T) => string | number | boolean | Date | null;
  /**
   * A reference to another sheet's row, written as "Name [id]".
   *
   * Names alone cannot survive a round trip: they are not unique, they change,
   * and a renamed trip would silently create a second one on import. The id in
   * brackets is what the importer reads; the name is what makes the file
   * readable. Both are written, only the id is authoritative.
   */
  reference?: boolean;
  /**
   * Read-only in Excel. Ids and derived figures are locked so a stray edit
   * cannot quietly detach a row from its record or invent a total.
   */
  locked?: boolean;
}

export interface SheetSpec<T> {
  /** Worksheet name as it appears on the tab. */
  name: string;
  /** Machine key, matched when reading a workbook back. */
  key: string;
  columns: ColumnSpec<T>[];
  /**
   * One line under the header explaining what this sheet is and what editing
   * it does. Written into the sheet itself rather than a manual, because the
   * file travels without us.
   */
  hint?: string;
}

/** Format a reference cell: readable name plus the id that actually resolves. */
export function refCell(name: string | null | undefined, id: string | null | undefined): string {
  if (!id) return name ?? "";
  return name ? `${name} [${id}]` : `[${id}]`;
}

/**
 * Recover the id from a reference cell.
 *
 * Deliberately tolerant about the name half: someone may well retype "Japan
 * 2024" as "Japan-Reise 2024" while leaving the bracketed id alone, and that
 * has to keep resolving to the same trip. A cell with no brackets yields null
 * — the importer then treats it as "no reference", never as a name to guess
 * from, because guessing is how one trip becomes two.
 */
export function parseRefCell(cell: string | null | undefined): string | null {
  if (!cell) return null;
  const match = /\[([^\]]+)\]\s*$/.exec(cell.trim());
  return match ? match[1].trim() || null : null;
}
