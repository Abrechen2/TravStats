/**
 * POST /app-import's engine: read another travel app's export, hand its
 * records to the spreadsheet importer's sheets (flights, rail, lodging,
 * places) in add mode, and answer in that importer's outcome shape with the
 * records that could not be used added as error rows.
 */

import { prisma } from "../../db";
import { importSheets } from "../xlsxImport/importSheets";
import {
  summarise,
  type ImportOutcome,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "../xlsxImport/types";
import { buildSheets } from "../checkinImport/toSheets";
import { buildFlightRows } from "./build";
import { parseFlightLogCsv } from "./csvFlightLog";
import { parsePolarsteps } from "./polarsteps";
import { parseTripit } from "./tripit";
import type { AppParse, AppReject, AppSource, SheetRecord } from "./types";

export function parseAppFile(source: AppSource, text: string): AppParse {
  switch (source) {
    case "tripit":
      return parseTripit(text);
    case "polarsteps":
      return parsePolarsteps(text);
    default:
      return parseFlightLogCsv(source, text);
  }
}

const withRows = (key: string, records: Array<{ row: number; cells: Record<string, string> }>) => ({
  key,
  rows: records.map((r) => r.cells),
  rowNumbers: records.map((r) => r.row),
});

/**
 * A source that names a hotel without its city (an iCal feed) must not create
 * a second lodging next to the stored one, and its stay would then not find
 * its hotel ("ambiguous_lodging"). A lodging row is dropped when the account
 * holds exactly one lodging of that name whose city is the same or unknown on
 * either side; the stay then attaches to the stored one.
 */
async function withoutStoredLodging(userId: string, rows: SheetRecord[]): Promise<SheetRecord[]> {
  const kept: SheetRecord[] = [];
  for (const r of rows) {
    const name = r.cells.name;
    const stored = await prisma.lodging.findMany({
      where: { userId, name: { equals: name, mode: "insensitive" } },
      select: { city: true },
      take: 2,
    });
    const city = r.cells.city?.trim().toLowerCase();
    const same = stored.filter((l) => !city || !l.city || l.city.toLowerCase() === city);
    if (stored.length === 1 && same.length === 1) continue;
    kept.push(r);
  }
  return kept;
}

export async function runAppImport(
  userId: string,
  opts: { source: AppSource; text: string; dryRun: boolean }
): Promise<ImportOutcome> {
  const parsed = parseAppFile(opts.source, opts.text);
  parsed.lodging = await withoutStoredLodging(userId, parsed.lodging);
  const flights = await buildFlightRows(parsed.flights);
  const rail = await buildSheets(parsed.rides);

  const notes = new Map<string, string>();
  for (const [row, note] of flights.notes) notes.set(`flights:${row}`, note);
  for (const key of ["lodging", "lodgingStays", "places", "placeVisits"] as const) {
    for (const r of parsed[key]) if (r.note) notes.set(`${key}:${r.row}`, r.note);
  }

  const sheets: IncomingSheet[] = [];
  if (flights.rows.length > 0) {
    sheets.push({ key: "flights", rows: flights.rows, rowNumbers: flights.rowNumbers });
  }
  for (const key of ["lodging", "lodgingStays", "places", "placeVisits"] as const) {
    if (parsed[key].length > 0) sheets.push(withRows(key, parsed[key]));
  }
  if (rail.rail.rows.length > 0) {
    sheets.push({ key: "rail", rows: rail.rail.rows, rowNumbers: rail.rail.rowNumbers });
  }
  if (rail.bus.rows.length > 0) {
    sheets.push({ key: "bus", rows: rail.bus.rows, rowNumbers: rail.bus.rowNumbers });
  }
  // Add mode only: an app's export must never overwrite what the user has
  // since edited on an entry they already have.
  const results: SheetOutcome[] =
    sheets.length > 0
      ? await importSheets(sheets, { userId, dryRun: opts.dryRun, mode: "add" })
      : [];

  const extra: Array<{ sheet: string; row: RowOutcome }> = [
    ...parsed.rejects,
    ...flights.rejects,
    ...rail.rejects.map((r) => ({ ...r, sheet: r.sheet as AppReject["sheet"] })),
  ].map((r) => ({
    sheet: r.sheet,
    row: { row: r.row, action: "error" as const, id: null, label: r.label, message: r.reason },
  }));
  for (const r of [...flights.duplicates, ...rail.duplicates]) {
    extra.push({
      sheet: r.sheet,
      row: { row: r.row, action: "skip", id: null, label: r.label, message: r.reason },
    });
  }

  const keys = [
    ...new Set<string>([...results.map((s) => s.key), ...extra.map((e) => e.sheet)]),
  ].sort();
  const merged = keys.map((key) => {
    const own = (results.find((s) => s.key === key)?.rows ?? []).map((r) => {
      const note = r.action === "create" ? notes.get(`${key}:${r.row}`) : undefined;
      return note ? { ...r, notes: [...(r.notes ?? []), note] } : r;
    });
    const added = extra.filter((e) => e.sheet === key).map((e) => e.row);
    return summarise(
      key,
      [...own, ...added].sort((a, b) => a.row - b.row)
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
