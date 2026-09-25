/**
 * Apply the sheets of an imported workbook.
 *
 * The whole thing runs twice for every real import: once as a dry run that
 * writes nothing and reports what WOULD happen, and — only if the user then
 * confirms — once for real. An import can rewrite hundreds of rows at once;
 * showing that first is the difference between a tool and a trap.
 *
 * What a row means (owner decision 2026-09-25 — the workbook is for editing
 * AND for moving entries, also into another account):
 *
 *   - an id of THIS account → update that record;
 *   - no id, an unknown id, or another account's id → the entry is new here:
 *     matched to an existing record by its natural key (so reading the same
 *     file twice converges instead of duplicating), otherwise created.
 *
 * THE SECURITY PROPERTY, since it is easy to lose in a refactor: every lookup
 * of an id from the file is scoped by `userId`. An id in a spreadsheet is a
 * claim, not a proof. A foreign id therefore never reaches an UPDATE and is
 * never read back — it only links rows that travel together in the file (see
 * `context.ts`). A foreign id and an unknown id behave identically on purpose;
 * distinguishing them would confirm that the other record exists.
 *
 * The domain handlers live one per file beside this one; this module owns the
 * order and the once-per-run follow-ups.
 */

import { recomputeLegsForCruise } from "../cruiseDistance/cruiseLegService";
import { recheckAchievements } from "../../utils/achievements";
import { newCtx, errorRow, type Ctx } from "./context";
import { importCruiseStops, importCruises } from "./cruises";
import { importFlights } from "./flights";
import { importLodging, importLodgingStays } from "./lodging";
import { importPlaceVisits, importPlaces } from "./places";
import { importRail } from "./rail";
import { importRoadtripStations } from "./roadtripStations";
import { importRoadtrips } from "./roadtrips";
import { importTourPoints } from "./tourPoints";
import { importTours } from "./tours";
import { markKeptDrops } from "./values";
import { summarise, type ImportMode, type IncomingSheet, type SheetOutcome } from "./types";

/** Cap per sheet. A spreadsheet is a hand-editing tool; anything larger is an
 *  import job, and one request should not sit in a transaction for minutes. */
export const MAX_ROWS_PER_SHEET = 5000;

type Handler = (sheet: IncomingSheet, ctx: Ctx) => Promise<SheetOutcome>;

/**
 * Sheets this importer understands, in the order they run. A key that is not
 * here is ignored rather than rejected — someone may keep their own tab.
 *
 * Order matters: every parent sheet runs before its children, so a file that
 * creates a hotel and its stays (or a place and its visits, a cruise and its
 * stops) works in one pass — the child rows find the parent this run placed.
 * Tours come after roadtrips AND their stations, because a tour's anchor may
 * be a station this same file moved; tour points last.
 */
const HANDLERS: Record<string, Handler> = {
  flights: importFlights,
  places: importPlaces,
  placeVisits: importPlaceVisits,
  cruises: importCruises,
  cruiseStops: importCruiseStops,
  lodging: importLodging,
  lodgingStays: importLodgingStays,
  roadtrips: importRoadtrips,
  roadtripStations: importRoadtripStations,
  tours: importTours,
  tourPoints: importTourPoints,
  // Rail rides (rail spec) point at trips only, so their place in the order
  // is free; last, as the export writes the sheet last.
  rail: importRail,
};

export function isImportable(key: string): boolean {
  return key in HANDLERS;
}

/**
 * Run every recognised sheet.
 *
 * Sheets are processed in a fixed order so a preview reads the same way twice,
 * and sequentially because the row handlers hit the database per row.
 */
export async function importSheets(
  sheets: IncomingSheet[],
  opts: { userId: string; dryRun: boolean; mode: ImportMode }
): Promise<SheetOutcome[]> {
  const ctx = newCtx(opts);
  const results: SheetOutcome[] = [];

  for (const key of Object.keys(HANDLERS)) {
    const sheet = sheets.find((s) => s.key === key);
    // A sheet that is absent, or present but empty, is left alone entirely —
    // including in `replace` mode. Reading an empty sheet as "delete all of
    // this domain" would turn a file someone cleared by accident, or a tab
    // they never filled, into total data loss.
    if (!sheet || sheet.rows.length === 0) continue;
    if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
      results.push(summarise(key, [errorRow(0, key, "too_many_rows")], 0));
      continue;
    }
    const outcome = await HANDLERS[key](sheet, ctx);
    results.push({ ...outcome, rows: markKeptDrops(outcome.rows) });
  }

  if (!ctx.dryRun) {
    // Stops changed under these cruises; the distance and the map read the
    // legs, which only this recompute writes.
    for (const cruiseId of ctx.touchedCruises) await recomputeLegsForCruise(cruiseId);
    // Once per run, not per row: a hundred stays are one change to the badges.
    if (ctx.wrote) await recheckAchievements(ctx.userId, "xlsx_import");
  }

  return results;
}
