/**
 * Client half of the spreadsheet import.
 *
 * The workbook is parsed HERE, not on the server: exceljs already runs in the
 * browser for the export, and keeping a spreadsheet parser out of the server
 * removes a file-format attack surface from it entirely. What crosses the wire
 * is plain rows of strings, which the server then validates as untrusted input
 * regardless of how they were produced.
 */

import api from "./../api/client";
import { parseWorkbook } from "./workbook";
import {
  cruiseSheet,
  cruiseStopSheet,
  flightSheet,
  lodgingSheet,
  lodgingStaySheet,
  placeSheet,
  placeVisitSheet,
} from "./sheets";
import type { SheetSpec } from "./sheetSpec";

type T = (key: string) => string;

export type RowAction = "create" | "update" | "skip" | "error" | "delete";

/** See the server-side contract in services/xlsxImport/types.ts. */
export type ImportMode = "add" | "merge" | "replace";

export interface RowOutcome {
  row: number;
  action: RowAction;
  id: string | null;
  label: string;
  /** Error reason, or how an existing entry was found (`matched_existing`). */
  message?: string;
  /** Non-fatal remarks, e.g. `trip_not_linked`. */
  notes?: string[];
  /** Cells the column does not know — left empty, the row still applied. */
  dropped?: { field: string; value: string }[];
}

export interface SheetOutcome {
  key: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  /** Rows in the database that the file did not mention. Deleted in
   *  `replace`, merely counted otherwise — this is the number the warning
   *  has to show, because those rows are invisible in the sheet. */
  deleted: number;
  rows: RowOutcome[];
}

export interface ImportOutcome {
  dryRun: boolean;
  mode: ImportMode;
  clean: boolean;
  sheets: SheetOutcome[];
  /** Backup taken before a destructive import, so "undo" has an answer. */
  backupId: string | null;
}

/**
 * The sheets the server can apply — every sheet the export writes, in the
 * export's own order (the tab names are de-duplicated in sequence, so reader
 * and writer must walk the same list).
 *
 * Cruise stops and lodging stays joined on 2026-09-25: the workbook is for
 * editing AND moving entries, and a moved hotel without its stays, or a
 * cruise without its itinerary, is not a moved entry.
 */
export function importableSpecs(t: T): SheetSpec<never>[] {
  return [
    flightSheet(t),
    cruiseSheet(t),
    cruiseStopSheet(t),
    lodgingSheet(t),
    lodgingStaySheet(t),
    placeSheet(t),
    placeVisitSheet(t),
  ] as unknown as SheetSpec<never>[];
}

/** Read the workbook into the payload shape the server expects. */
export async function readWorkbookForImport(
  t: T,
  file: File
): Promise<{ key: string; rows: Record<string, string>[] }[]> {
  const buffer = await file.arrayBuffer();
  const parsed = await parseWorkbook(buffer, importableSpecs(t));
  return parsed.filter((sheet) => sheet.rows.length > 0);
}

/**
 * Send the sheets. `dryRun` writes nothing and reports what would happen —
 * always call it that way first, and only pass false once the user has seen
 * the result and agreed.
 */
/**
 * Thrown when the server refused the import for a reason the user can act on.
 *
 * `kind` is a fixed vocabulary, not prose: the caller decides which sentence
 * to show. Reporting "the file could not be read" for a failed safety backup
 * sends someone to check their spreadsheet while the actual problem is the
 * server's backup storage — which is exactly what happened in the rc.18 UAT.
 */
export class ImportRefused extends Error {
  constructor(public readonly kind: "backupFailed" | "unknown") {
    super(kind);
    this.name = "ImportRefused";
  }
}

export async function sendImport(
  sheets: { key: string; rows: Record<string, string>[] }[],
  dryRun: boolean,
  mode: ImportMode = "merge"
): Promise<ImportOutcome> {
  try {
    const { data } = await api.post<{ success: boolean; data: ImportOutcome }>("/xlsx-import", {
      dryRun,
      mode,
      sheets,
    });
    return data.data;
  } catch (err) {
    const body = (err as { response?: { data?: { error?: string } } }).response?.data;
    if (body?.error === "backup_failed") throw new ImportRefused("backupFailed");
    throw err;
  }
}
