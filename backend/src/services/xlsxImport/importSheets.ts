/**
 * Apply the sheets of an imported workbook.
 *
 * The whole thing runs twice for every real import: once as a dry run that
 * writes nothing and reports what WOULD happen, and — only if the user then
 * confirms — once for real. An import can rewrite hundreds of rows at once;
 * showing that first is the difference between a tool and a trap.
 *
 * THE SECURITY PROPERTY, since it is easy to lose in a refactor: every lookup
 * of an id from the file is scoped by `userId`. An id in a spreadsheet is a
 * claim, not a proof — the file came from the user, who may have typed
 * anything into column A. `findFirst({ where: { id, userId } })` is what makes
 * a foreign id a refused row rather than someone else's record being
 * overwritten. A foreign id and an unknown id get the SAME message on purpose;
 * distinguishing them would confirm that the other record exists.
 */

import { prisma } from "../../db";
import { createPlaceSchema } from "../../schemas/place";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import * as cell from "./cells";
import { summarise, type IncomingSheet, type RowOutcome, type SheetOutcome } from "./types";

/** Cap per sheet. A spreadsheet is a hand-editing tool; anything larger is an
 *  import job, and one request should not sit in a transaction for minutes. */
export const MAX_ROWS_PER_SHEET = 5000;

interface Ctx {
  userId: string;
  dryRun: boolean;
}

/** Same wording for "not yours" and "does not exist" — see the module note. */
const UNKNOWN_ID = "unknown_id";

function errorRow(row: number, label: string, message: string): RowOutcome {
  return { row, action: "error", id: null, label, message };
}

// ------------------------------------------------------------------ places

async function importPlaces(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];

  for (const [index, raw] of sheet.rows.entries()) {
    // +2: one for 1-based rows, one for the header. Matches what Excel shows.
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const id = cell.text(raw.id);

    const lat = cell.num(raw.lat);
    const lon = cell.num(raw.lon);
    if ((lat !== undefined && Number.isNaN(lat)) || (lon !== undefined && Number.isNaN(lon))) {
      out.push(errorRow(rowNo, label, "invalid_coordinates"));
      continue;
    }

    const fields = {
      name: cell.text(raw.name),
      category: cell.text(raw.category),
      lat,
      lon,
      address: cell.text(raw.address),
      city: cell.text(raw.city),
      country: cell.text(raw.country),
      notes: cell.text(raw.notes),
      visited: cell.bool(raw.visited),
    };

    if (id) {
      // Scoped by userId — this is the ownership check, not a convenience.
      const existing = await prisma.place.findFirst({
        where: { id, userId: ctx.userId },
        select: { id: true },
      });
      if (!existing) {
        out.push(errorRow(rowNo, label, UNKNOWN_ID));
        continue;
      }

      // Only the keys the sheet actually carried. An untouched column must not
      // become a null that erases a stored value.
      const data = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Record<string, unknown>;
      if (data.country) data.isoCountryCode = resolveCountryCode(String(data.country));

      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id, label });
        continue;
      }
      if (!ctx.dryRun) await prisma.place.update({ where: { id }, data });
      out.push({ row: rowNo, action: "update", id, label });
      continue;
    }

    // No id → a new place. Validated by the SAME schema the API uses, so the
    // importer cannot become a back door around the rules the form obeys.
    const parsed = createPlaceSchema.safeParse({
      name: fields.name,
      category: fields.category ?? "other",
      lat: fields.lat,
      lon: fields.lon,
      address: fields.address ?? null,
      city: fields.city ?? null,
      country: fields.country ?? null,
      notes: fields.notes ?? null,
      visited: fields.visited ?? false,
    });
    if (!parsed.success) {
      out.push(errorRow(rowNo, label, parsed.error.issues[0]?.message ?? "invalid_row"));
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun) {
      const created = await prisma.place.create({
        data: {
          userId: ctx.userId,
          ...parsed.data,
          isoCountryCode: resolveCountryCode(parsed.data.country ?? null),
          dataSource: "xlsx",
        },
        select: { id: true },
      });
      newId = created.id;
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  return summarise(sheet.key, out);
}

// ----------------------------------------------------------------- cruises

/** Cruises carry no schema-level create path here: a cruise created from a
 *  spreadsheet with no stops, ship or ports is not a usable record, and the
 *  form exists for that. Rows WITHOUT an id are therefore reported as errors
 *  rather than silently making an empty cruise. Editing existing ones — the
 *  actual reason to open a spreadsheet — works fully. */
async function importCruises(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.routeName) ?? cell.text(raw.ship) ?? `#${rowNo}`;
    const id = cell.text(raw.id);

    if (!id) {
      out.push(errorRow(rowNo, label, "cruise_needs_id"));
      continue;
    }

    const existing = await prisma.cruise.findFirst({
      where: { id, userId: ctx.userId },
      select: { id: true },
    });
    if (!existing) {
      out.push(errorRow(rowNo, label, UNKNOWN_ID));
      continue;
    }

    const startDate = cell.isoDate(raw.startDate);
    const endDate = cell.isoDate(raw.endDate);
    if (startDate === null || endDate === null) {
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }

    const price = cell.num(raw.price);
    if (price !== undefined && Number.isNaN(price)) {
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }

    const fields: Record<string, unknown> = {
      cruiseLine: cell.text(raw.cruiseLine),
      routeName: cell.text(raw.routeName),
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      cabinNumber: cell.text(raw.cabinNumber),
      deck: cell.int(raw.deck),
      bookingReference: cell.text(raw.bookingReference),
      price,
      currency: cell.text(raw.currency),
      notes: cell.text(raw.notes),
      tags: cell.list(raw.tags),
      companions: cell.list(raw.companions),
    };

    // A trip reference resolves through the same ownership rule as the row
    // itself: pointing a cruise at a stranger's trip must not be possible.
    const tripId = cell.ref(raw.tripId);
    if (tripId) {
      const trip = await prisma.trip.findFirst({
        where: { id: tripId, userId: ctx.userId },
        select: { id: true },
      });
      if (!trip) {
        out.push(errorRow(rowNo, label, "unknown_trip"));
        continue;
      }
      fields.tripId = tripId;
    }

    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (Object.keys(data).length === 0) {
      out.push({ row: rowNo, action: "skip", id, label });
      continue;
    }
    if (!ctx.dryRun) await prisma.cruise.update({ where: { id }, data });
    out.push({ row: rowNo, action: "update", id, label });
  }

  return summarise(sheet.key, out);
}

// ----------------------------------------------------------------- lodging

async function importLodging(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const id = cell.text(raw.id);

    if (!id) {
      out.push(errorRow(rowNo, label, "lodging_needs_id"));
      continue;
    }

    const existing = await prisma.lodging.findFirst({
      where: { id, userId: ctx.userId },
      select: { id: true },
    });
    if (!existing) {
      out.push(errorRow(rowNo, label, UNKNOWN_ID));
      continue;
    }

    const lat = cell.num(raw.lat);
    const lon = cell.num(raw.lon);
    const stars = cell.int(raw.stars);
    if (
      (lat !== undefined && Number.isNaN(lat)) ||
      (lon !== undefined && Number.isNaN(lon)) ||
      (stars !== undefined && Number.isNaN(stars))
    ) {
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }

    const country = cell.text(raw.country);
    const fields: Record<string, unknown> = {
      name: cell.text(raw.name),
      address: cell.text(raw.address),
      city: cell.text(raw.city),
      country,
      isoCountryCode: country ? (resolveCountryCode(country) ?? undefined) : undefined,
      lat,
      lon,
      stars,
      notes: cell.text(raw.notes),
      visited: cell.bool(raw.visited),
      amenities: cell.list(raw.amenities),
    };

    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (Object.keys(data).length === 0) {
      out.push({ row: rowNo, action: "skip", id, label });
      continue;
    }
    if (!ctx.dryRun) await prisma.lodging.update({ where: { id }, data });
    out.push({ row: rowNo, action: "update", id, label });
  }

  return summarise(sheet.key, out);
}

// ------------------------------------------------------------------ router

type Handler = (sheet: IncomingSheet, ctx: Ctx) => Promise<SheetOutcome>;

/** Sheets this importer understands. A sheet key that is not here is ignored
 *  rather than rejected — someone may keep their own tab in the file. */
const HANDLERS: Record<string, Handler> = {
  places: importPlaces,
  cruises: importCruises,
  lodging: importLodging,
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
  ctx: Ctx,
): Promise<SheetOutcome[]> {
  const results: SheetOutcome[] = [];

  for (const key of Object.keys(HANDLERS)) {
    const sheet = sheets.find((s) => s.key === key);
    if (!sheet || sheet.rows.length === 0) continue;
    if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
      results.push(summarise(key, [errorRow(0, key, "too_many_rows")]));
      continue;
    }
    results.push(await HANDLERS[key](sheet, ctx));
  }

  return results;
}
