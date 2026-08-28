/**
 * What a spreadsheet import is, before any domain is involved.
 *
 * The file arrives as rows of strings — Excel has no idea what a cruise is —
 * so every domain handler does the same three things in the same order, and
 * this module names them so no handler can quietly skip one:
 *
 *   1. **Resolve the id.** Present and owned by the caller → update. Absent →
 *      create. Present but NOT owned, or unknown → refuse the row.
 *   2. **Coerce and validate** through the domain's existing Zod schema. The
 *      importer does not get its own idea of what a valid cruise is.
 *   3. **Report**, per row, what would happen — because an import runs as a
 *      dry run first.
 *
 * Step 1 is the one with teeth. An id in a spreadsheet is a claim, not a
 * proof: the file is user-supplied, so a row carrying someone else's id must
 * never reach an UPDATE. Looking the row up by id alone would find it and
 * change it. Every lookup is therefore scoped by `userId`, and a row whose id
 * exists but belongs to another account is refused with the same message as
 * one whose id does not exist at all — telling them apart would confirm that
 * the other row exists.
 */

/** What the importer intends to do with one spreadsheet row. */
export type RowAction = "create" | "update" | "skip" | "error";

export interface RowOutcome {
  /** 1-based row number in the sheet, as the user sees it in Excel. */
  row: number;
  action: RowAction;
  /** The record id — the existing one for an update, the new one after a real
   *  create, null while a create is still only planned. */
  id: string | null;
  /** Short human label so the preview reads as records, not row numbers. */
  label: string;
  /** Why the row was refused. Present only for `error`. */
  message?: string;
}

export interface SheetOutcome {
  /** Sheet key from the shared spec (`cruises`, `places`, …). */
  key: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  rows: RowOutcome[];
}

export interface ImportOutcome {
  dryRun: boolean;
  sheets: SheetOutcome[];
  /** True when no sheet produced an error — what the UI gates "Apply" on. */
  clean: boolean;
}

/** One sheet as it arrives from the client: rows of column-key → cell text. */
export interface IncomingSheet {
  key: string;
  rows: Record<string, string>[];
}

/** Tally a list of row outcomes into the counts the preview shows. */
export function summarise(key: string, rows: RowOutcome[]): SheetOutcome {
  return {
    key,
    created: rows.filter((r) => r.action === "create").length,
    updated: rows.filter((r) => r.action === "update").length,
    skipped: rows.filter((r) => r.action === "skip").length,
    errors: rows.filter((r) => r.action === "error").length,
    rows,
  };
}
