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

/**
 * How an import treats the rows already in the database.
 *
 *  - `add`     only creates. A row carrying an id is SKIPPED, never written.
 *              Nothing existing can change, which makes this the mode to
 *              reach for when a file's provenance is uncertain.
 *  - `merge`   the default. A row with an id updates the record it names, a
 *              row without one is created. Rows absent from the file are left
 *              alone.
 *  - `replace` merge, and then DELETES every row of the imported sheets that
 *              the file did not mention. This is the only destructive mode,
 *              and the only one that takes a full backup first.
 */
export type ImportMode = "add" | "merge" | "replace";

/** What the importer intends to do with one spreadsheet row. */
export type RowAction = "create" | "update" | "skip" | "error" | "delete";

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
  /**
   * Rows that exist in the database and are NOT in the file — deleted in
   * `replace` mode, counted but untouched in every other mode and in a dry
   * run. This number is what the confirmation dialog has to show: it is the
   * damage, and it is invisible in the sheet the user is looking at.
   */
  deleted: number;
  rows: RowOutcome[];
}

export interface ImportOutcome {
  dryRun: boolean;
  mode: ImportMode;
  sheets: SheetOutcome[];
  /** True when no sheet produced an error — what the UI gates "Apply" on. */
  clean: boolean;
  /**
   * Id of the backup taken before a destructive import, so the answer to
   * "undo this" is a restore rather than an apology. Null in every
   * non-destructive case, and in a dry run.
   */
  backupId: string | null;
}

/** One sheet as it arrives from the client: rows of column-key → cell text. */
export interface IncomingSheet {
  key: string;
  rows: Record<string, string>[];
}

/** Tally a list of row outcomes into the counts the preview shows. */
export function summarise(key: string, rows: RowOutcome[], deleted = 0): SheetOutcome {
  return {
    key,
    created: rows.filter((r) => r.action === "create").length,
    updated: rows.filter((r) => r.action === "update").length,
    skipped: rows.filter((r) => r.action === "skip").length,
    errors: rows.filter((r) => r.action === "error").length,
    deleted,
    rows,
  };
}
