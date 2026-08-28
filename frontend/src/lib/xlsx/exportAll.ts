/**
 * The whole logbook as one spreadsheet: a tab per table, readable, and
 * re-importable because every row carries its id.
 *
 * Sheets are only added for domains that actually have rows. An instance with
 * cruises switched off should not receive an empty "Cruises" tab to wonder
 * about — the file describes what is there, not what the schema allows.
 */

import type { Flight } from "../../types";
import type { Cruise } from "../../types/cruise";
import type { Lodging } from "../../types/lodging";
import type { Place } from "../../types/place";
import {
  flightSheet,
  cruiseSheet,
  cruiseStopSheet,
  lodgingSheet,
  lodgingStaySheet,
  placeSheet,
  placeVisitSheet,
  type CruiseStopRow,
  type LodgingStayRow,
  type PlaceVisitRow,
} from "./sheets";
import { buildWorkbookBlob, sheet, type AnySheetData } from "./workbook";

type T = (key: string) => string;

export interface ExportInput {
  flights?: readonly Flight[];
  cruises?: readonly Cruise[];
  lodging?: readonly Lodging[];
  places?: readonly Place[];
}

/** A short, stable label for a parent row, used as the readable half of a
 *  reference cell. Long enough to recognise, short enough to read in a cell. */
function cruiseLabel(c: Cruise): string {
  return c.routeName ?? c.shipNameOverride ?? c.ship?.name ?? c.cruiseLine ?? c.id;
}

/**
 * Flatten the child collections into their own rows, each carrying the parent
 * id it belongs to. Done here rather than in the sheet spec because a spec
 * describes columns, not how a tree becomes tables.
 */
function cruiseStopRows(cruises: readonly Cruise[]): CruiseStopRow[] {
  const rows: CruiseStopRow[] = [];
  for (const c of cruises) {
    const label = cruiseLabel(c);
    for (const stop of c.stops ?? []) {
      rows.push({ ...stop, cruiseId: c.id, cruiseLabel: label });
    }
  }
  return rows;
}

function lodgingStayRows(lodgings: readonly Lodging[]): LodgingStayRow[] {
  const rows: LodgingStayRow[] = [];
  for (const l of lodgings) {
    for (const stay of l.stays ?? []) {
      rows.push({ ...stay, lodgingId: l.id, lodgingLabel: l.name });
    }
  }
  return rows;
}

function placeVisitRows(places: readonly Place[]): PlaceVisitRow[] {
  const rows: PlaceVisitRow[] = [];
  for (const p of places) {
    for (const visit of p.visits ?? []) {
      rows.push({ ...visit, placeId: p.id, placeLabel: p.name });
    }
  }
  return rows;
}

/** Assemble the sheets that have content. Exported for tests, which inspect
 *  the sheet list without going through a Blob. */
export function buildSheets(t: T, input: ExportInput, locale = "de"): AnySheetData[] {
  const sheets: AnySheetData[] = [];

  const flights = input.flights ?? [];
  if (flights.length > 0) sheets.push(sheet(flightSheet(t), flights));

  const cruises = input.cruises ?? [];
  if (cruises.length > 0) {
    sheets.push(sheet(cruiseSheet(t), cruises));
    const stops = cruiseStopRows(cruises);
    if (stops.length > 0) sheets.push(sheet(cruiseStopSheet(t), stops));
  }

  const lodging = input.lodging ?? [];
  if (lodging.length > 0) {
    sheets.push(sheet(lodgingSheet(t), lodging));
    const stays = lodgingStayRows(lodging);
    if (stays.length > 0) sheets.push(sheet(lodgingStaySheet(t), stays));
  }

  const places = input.places ?? [];
  if (places.length > 0) {
    sheets.push(sheet(placeSheet(t, locale), places));
    const visits = placeVisitRows(places);
    if (visits.length > 0) sheets.push(sheet(placeVisitSheet(t), visits));
  }

  return sheets;
}

/** Build the file. Returns null when there is nothing at all to write, so the
 *  caller can say so rather than hand over an empty workbook. */
export async function exportWorkbook(
  t: T,
  input: ExportInput,
  locale = "de",
): Promise<Blob | null> {
  const sheets = buildSheets(t, input, locale);
  if (sheets.length === 0) return null;
  return buildWorkbookBlob(sheets);
}

/** `travstats-export-2026-08-28.xlsx` — sorts chronologically in a folder. */
export function exportFilename(t: T, now: Date): string {
  const stamp = now.toISOString().slice(0, 10);
  return `${t("xlsx:export.filename")}-${stamp}.xlsx`;
}
