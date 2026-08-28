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
  lodgingSheet,
  placeSheet,
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
  message?: string;
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
 * Only the sheets the server can apply.
 *
 * The child sheets (stops, stays, visits) are exported for reading but not
 * imported yet: each one needs its own parent-scoped rules, and shipping half
 * of that would let someone edit a stop and see nothing happen — worse than
 * not offering it. They are simply not sent.
 */
function importableSpecs(t: T): SheetSpec<never>[] {
  return [placeSheet(t), cruiseSheet(t), lodgingSheet(t)] as unknown as SheetSpec<never>[];
}

/** Read the workbook into the payload shape the server expects. */
export async function readWorkbookForImport(
  t: T,
  file: File,
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
  mode: ImportMode = "merge",
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
