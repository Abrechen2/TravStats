/**
 * POST /checkin-import's engine: parse a Träwelling / travelynx export, hand
 * the rides to the spreadsheet importer's rail and bus sheets, and answer in
 * that importer's outcome shape with the unreadable rows added.
 */

import { importSheets } from "../xlsxImport/importSheets";
import {
  summarise,
  type ImportOutcome,
  type RowOutcome,
  type SheetOutcome,
} from "../xlsxImport/types";
import { buildSheets } from "./toSheets";
import { parseTraewellingCsv, parseTraewellingJson } from "./travelling";
import { parseTravelynxJson } from "./travelynx";
import type { CheckinParse, CheckinSource } from "./types";

export type CheckinFormat = "csv" | "json";

export function detectFormat(text: string): CheckinFormat {
  return /^\s*[[{]/.test(text.replace(/^\uFEFF/, "")) ? "json" : "csv";
}

export function parseCheckinFile(
  source: CheckinSource,
  text: string,
  format: CheckinFormat = detectFormat(text)
): CheckinParse {
  if (source === "travelynx") return parseTravelynxJson(text);
  return format === "json" ? parseTraewellingJson(text) : parseTraewellingCsv(text);
}

export async function runCheckinImport(
  userId: string,
  opts: { source: CheckinSource; text: string; format?: CheckinFormat; dryRun: boolean }
): Promise<ImportOutcome> {
  const parsed = parseCheckinFile(opts.source, opts.text, opts.format);
  const built = await buildSheets(parsed.rides);

  const sheets = (["rail", "bus"] as const)
    .filter((key) => built[key].rows.length > 0)
    .map((key) => ({ key, ...built[key] }));
  // Add mode only: a check-in app's note must never overwrite what the user
  // has since edited on a ride they already have.
  const results: SheetOutcome[] =
    sheets.length > 0
      ? await importSheets(sheets, { userId, dryRun: opts.dryRun, mode: "add" })
      : [];

  const problems: Array<{ sheet: "rail" | "bus"; row: RowOutcome }> = [
    ...parsed.rejects.map((r) => ({ sheet: "rail" as const, ...r })),
    ...built.rejects,
  ].map((r) => ({
    sheet: r.sheet,
    row: { row: r.row, action: "error" as const, id: null, label: r.label, message: r.reason },
  }));
  const skipped = built.duplicates.map((r) => ({
    sheet: r.sheet,
    row: { row: r.row, action: "skip" as const, id: null, label: r.label, message: r.reason },
  }));

  const keys = new Set<string>([
    ...results.map((s) => s.key),
    ...[...problems, ...skipped].map((p) => p.sheet),
  ]);
  const merged = [...keys].sort().map((key) => {
    const own = results.find((s) => s.key === key)?.rows ?? [];
    const extra = [...problems, ...skipped].filter((p) => p.sheet === key).map((p) => p.row);
    return summarise(
      key,
      [...own, ...extra].sort((a, b) => a.row - b.row)
    );
  });
  return {
    dryRun: opts.dryRun,
    mode: "add",
    sheets: merged,
    clean: merged.every((s) => s.errors === 0),
    backupId: null,
  };
}
