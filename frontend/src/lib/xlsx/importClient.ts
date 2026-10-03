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
import { JobFailedError, JobLostError, waitForJob } from "../api/jobs";
import { parseWorkbook, type ParsedSheet } from "./workbook";
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
import { roadtripSheet, roadtripStationSheet, tourPointSheet, tourSheet } from "./roadtripSheets";
import { railSheet } from "./railSheet";
import { roadtripExpenseSheet } from "./roadtripExpenseSheet";

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
  /** Cells the column does not know — the row is still applied. `kept` when
   *  the row resolved to an existing entry, whose stored value then stays;
   *  absent on a create, where the field is left empty. */
  dropped?: { field: string; value: string; kept?: true }[];
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
 *
 * The rail sheet is read only where rail is visible (`useRailVisible`: the
 * `railDomain` beta switch AND the user's domain) — the owner rule that keeps
 * rail behind its gate. Last, where the export writes it.
 */
export function importableSpecs(t: T, options: { rail?: boolean } = {}): SheetSpec<never>[] {
  return [
    flightSheet(t),
    cruiseSheet(t),
    cruiseStopSheet(t),
    lodgingSheet(t),
    lodgingStaySheet(t),
    placeSheet(t),
    placeVisitSheet(t),
    // Roadtrips before their stations, tours after both — the export's order
    // and the order the server applies them in.
    roadtripSheet(t),
    roadtripStationSheet(t),
    roadtripExpenseSheet(t),
    tourSheet(t),
    tourPointSheet(t),
    ...(options.rail ? [railSheet(t)] : []),
  ] as unknown as SheetSpec<never>[];
}

/**
 * Read the workbook into the payload shape the server expects.
 *
 * Sheet names and headers are written in the exporting user's language; the
 * cell values are not. So the reader tries the interface language first and
 * then each of `otherLanguages` (forgejo#175: an English export was refused as
 * "no known sheets" under a German interface). A file is written in ONE
 * language, so the first language that finds anything is the answer.
 */
export async function readWorkbookForImport(
  t: T,
  file: File,
  options: { rail?: boolean } = {},
  otherLanguages: readonly T[] = []
): Promise<ParsedSheet[]> {
  const buffer = await file.arrayBuffer();
  for (const lang of [t, ...otherLanguages]) {
    const parsed = await parseWorkbook(buffer, importableSpecs(lang, options));
    const sheets = parsed.filter((sheet) => sheet.rows.length > 0);
    if (sheets.length > 0) return sheets;
  }
  return [];
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
  constructor(public readonly kind: "backupFailed" | "outcomeUnknown" | "unknown") {
    super(kind);
    this.name = "ImportRefused";
  }
}

/**
 * Runs as a server job (2026-09-26): a large sheet costs a currency lookup per
 * priced row and a `replace` a full backup first. Held open as one request,
 * the ten-second client timeout answered "import failed" while the server
 * went on writing rows. The request now returns a job id at once and this
 * waits for the job's own outcome.
 */
export async function sendImport(
  sheets: ParsedSheet[],
  dryRun: boolean,
  mode: ImportMode = "merge"
): Promise<ImportOutcome> {
  try {
    const { data } = await api.post<{ success: boolean; data: { jobId: string } }>("/xlsx-import", {
      dryRun,
      mode,
      sheets,
      background: true,
    });
    return await waitForJob<ImportOutcome>(data.data.jobId);
  } catch (err) {
    if (err instanceof JobFailedError && err.code === "backup_failed") {
      throw new ImportRefused("backupFailed");
    }
    // The server stopped reporting: rows may or may not have been written,
    // and "failed" would invite a second run over a first that succeeded.
    if (err instanceof JobLostError) throw new ImportRefused("outcomeUnknown");
    throw err;
  }
}
