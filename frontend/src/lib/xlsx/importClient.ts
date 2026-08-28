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

export type RowAction = "create" | "update" | "skip" | "error";

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
  rows: RowOutcome[];
}

export interface ImportOutcome {
  dryRun: boolean;
  clean: boolean;
  sheets: SheetOutcome[];
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
export async function sendImport(
  sheets: { key: string; rows: Record<string, string>[] }[],
  dryRun: boolean,
): Promise<ImportOutcome> {
  const { data } = await api.post<{ success: boolean; data: ImportOutcome }>("/xlsx-import", {
    dryRun,
    sheets,
  });
  return data.data;
}
