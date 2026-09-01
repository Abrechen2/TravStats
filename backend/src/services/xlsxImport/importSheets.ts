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
import { findOrCreateAirport } from "../airportLookup";
import logger from "../../utils/logger";
import { createPlaceSchema } from "../../schemas/place";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import * as cell from "./cells";
import {
  summarise,
  type ImportMode,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";

/** Cap per sheet. A spreadsheet is a hand-editing tool; anything larger is an
 *  import job, and one request should not sit in a transaction for minutes. */
export const MAX_ROWS_PER_SHEET = 5000;

interface Ctx {
  userId: string;
  dryRun: boolean;
  mode: ImportMode;
}

/** Same wording for "not yours" and "does not exist" — see the module note. */
const UNKNOWN_ID = "unknown_id";

function errorRow(row: number, label: string, message: string): RowOutcome {
  return { row, action: "error", id: null, label, message };
}

/**
 * Mark an id as accounted for even though its row failed.
 *
 * Caught by a test: without this, a mistyped latitude in `replace` mode does
 * not merely skip the row — it DELETES the record the row named, because the
 * id never reached `seen`. A refused row means "this line is unreadable", it
 * has never meant "destroy what it points at".
 */
function keepDespiteError(seen: Set<string>, id: string | undefined): void {
  if (id) seen.add(id);
}

/**
 * Delete the rows of one model that the file did not account for.
 *
 * Only in `replace` mode, only for the calling user, and only ever counted in
 * a dry run — the count is the whole point of previewing a destructive
 * import, because those rows are invisible in the sheet the user is looking
 * at. They are about to lose data they cannot see.
 *
 * A row the file mentioned but FAILED on is in `seen` and therefore safe: a
 * refused row is not permission to delete the record it named.
 */
async function pruneMissing(
  model: "place" | "cruise" | "lodging" | "flight",
  seen: Set<string>,
  ctx: Ctx,
): Promise<number> {
  if (ctx.mode !== "replace") return 0;

  const where = { userId: ctx.userId, id: { notIn: [...seen] } };

  // Written out per model rather than through a lookup: Prisma's delegates do
  // not share a callable signature, and a union of them is not invocable.
  const count = async (): Promise<number> => {
    if (model === "place") return prisma.place.count({ where });
    if (model === "cruise") return prisma.cruise.count({ where });
    if (model === "flight") return prisma.flight.count({ where });
    return prisma.lodging.count({ where });
  };
  const removeAll = async (): Promise<void> => {
    if (model === "place") await prisma.place.deleteMany({ where });
    else if (model === "cruise") await prisma.cruise.deleteMany({ where });
    else if (model === "flight") await prisma.flight.deleteMany({ where });
    else await prisma.lodging.deleteMany({ where });
  };

  const doomed = await count();
  if (doomed === 0) return 0;

  if (!ctx.dryRun) {
    await removeAll();
    logger.warn(
      { operation: "xlsx_import_replace_deleted", model, userId: ctx.userId, deleted: doomed },
      "Spreadsheet import in replace mode deleted rows absent from the file",
    );
  }
  return doomed;
}

// ------------------------------------------------------------------ places

async function importPlaces(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  /** Ids the file accounted for. Everything else is a deletion candidate in
   *  `replace` mode — including rows the file merely FAILED on, because a
   *  refused row is not permission to delete the record it named. */
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    // +2: one for 1-based rows, one for the header. Matches what Excel shows.
    const rowNo = index + 2;
    const label = cell.text(raw.name) ?? `#${rowNo}`;
    const id = cell.text(raw.id);

    const lat = cell.num(raw.lat);
    const lon = cell.num(raw.lon);
    if ((lat !== undefined && Number.isNaN(lat)) || (lon !== undefined && Number.isNaN(lon))) {
      keepDespiteError(seen, id);
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
      // "add" only ever creates. A row naming an existing record is reported
      // as skipped rather than refused: the file is fine, the mode simply
      // says not to touch what is already there.
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id, label, message: "exists" });
        continue;
      }

      // Only the keys the sheet actually carried. An untouched column must not
      // become a null that erases a stored value.
      const data = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      ) as Record<string, unknown>;
      if (data.country) data.isoCountryCode = resolveCountryCode(String(data.country));

      if (Object.keys(data).length === 0) {
        seen.add(id);
        out.push({ row: rowNo, action: "skip", id, label });
        continue;
      }
      if (!ctx.dryRun) await prisma.place.update({ where: { id }, data });
      seen.add(id);
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
      seen.add(created.id);
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  const deleted = await pruneMissing("place", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ----------------------------------------------------------------- cruises

/** Cruises carry no schema-level create path here: a cruise created from a
 *  spreadsheet with no stops, ship or ports is not a usable record, and the
 *  form exists for that. Rows WITHOUT an id are therefore reported as errors
 *  rather than silently making an empty cruise. Editing existing ones — the
 *  actual reason to open a spreadsheet — works fully. */
async function importCruises(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

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
      keepDespiteError(seen, id);
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }

    const price = cell.num(raw.price);
    if (price !== undefined && Number.isNaN(price)) {
      keepDespiteError(seen, id);
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
      seen.add(id);
      out.push({ row: rowNo, action: "skip", id, label });
      continue;
    }
    if (!ctx.dryRun) await prisma.cruise.update({ where: { id }, data });
    seen.add(id);
    out.push({ row: rowNo, action: "update", id, label });
  }

  const deleted = await pruneMissing("cruise", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ----------------------------------------------------------------- lodging

async function importLodging(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

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
      keepDespiteError(seen, id);
      keepDespiteError(seen, id);
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
      seen.add(id);
      out.push({ row: rowNo, action: "skip", id, label });
      continue;
    }
    if (!ctx.dryRun) await prisma.lodging.update({ where: { id }, data });
    seen.add(id);
    out.push({ row: rowNo, action: "update", id, label });
  }

  const deleted = await pruneMissing("lodging", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ----------------------------------------------------------- place visits

/**
 * Visits are a CHILD table: a visit only means something under one place.
 *
 * That changes the ownership question. The row's own id is checked the usual
 * way, but a NEW visit names its parent through the reference cell, and that
 * parent has to be the caller's too — otherwise a spreadsheet could attach a
 * visit to a stranger's place and read back a date from it.
 *
 * Left out on purpose: `orderIdx`. It is a tie-break the UI maintains by drag
 * order, and letting a sheet set it invites two visits claiming index 0. The
 * server keeps its own.
 */
async function importPlaceVisits(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const id = cell.text(raw.id);
    const label = cell.text(raw.placeId) ?? `#${rowNo}`;

    const visitedAt = cell.isoDate(raw.visitedAt);
    if (visitedAt === null) {
      keepDespiteError(seen, id);
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }

    const rating = cell.int(raw.rating);
    if (rating !== undefined && (Number.isNaN(rating) || rating < 1 || rating > 5)) {
      keepDespiteError(seen, id);
      out.push(errorRow(rowNo, label, "invalid_rating"));
      continue;
    }

    const fields: Record<string, unknown> = {
      visitedAt: visitedAt ? new Date(visitedAt) : undefined,
      rating,
      notes: cell.text(raw.notes),
    };

    if (id) {
      const existing = await prisma.placeVisit.findFirst({
        where: { id, userId: ctx.userId },
        select: { id: true },
      });
      if (!existing) {
        out.push(errorRow(rowNo, label, UNKNOWN_ID));
        continue;
      }
      if (ctx.mode === "add") {
        seen.add(id);
        out.push({ row: rowNo, action: "skip", id, label, message: "exists" });
        continue;
      }

      const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      seen.add(id);
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id, label });
        continue;
      }
      if (!ctx.dryRun) await prisma.placeVisit.update({ where: { id }, data });
      out.push({ row: rowNo, action: "update", id, label });
      continue;
    }

    // New visit: the parent reference is required and must be the caller's.
    const placeId = cell.ref(raw.placeId);
    if (!placeId) {
      out.push(errorRow(rowNo, label, "visit_needs_place"));
      continue;
    }
    const place = await prisma.place.findFirst({
      where: { id: placeId, userId: ctx.userId },
      select: { id: true },
    });
    if (!place) {
      out.push(errorRow(rowNo, label, "unknown_place"));
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun) {
      const created = await prisma.placeVisit.create({
        data: {
          userId: ctx.userId,
          placeId,
          visitedAt: visitedAt ? new Date(visitedAt) : null,
          rating: rating ?? null,
          notes: cell.text(raw.notes) ?? null,
        },
        select: { id: true },
      });
      newId = created.id;
      seen.add(created.id);
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  const deleted = await pruneMissingVisits(seen, ctx);
  return summarise(sheet.key, out, deleted);
}

/**
 * Replace-mode pruning for visits.
 *
 * Scoped to the caller like every other delete here. Separate from
 * `pruneMissing` because visits are not one of the three top-level models and
 * folding them into that union bought nothing but a wider signature.
 */
async function pruneMissingVisits(seen: Set<string>, ctx: Ctx): Promise<number> {
  if (ctx.mode !== "replace") return 0;
  const where = { userId: ctx.userId, id: { notIn: [...seen] } };
  const doomed = await prisma.placeVisit.count({ where });
  if (doomed === 0) return 0;
  if (!ctx.dryRun) {
    await prisma.placeVisit.deleteMany({ where });
    logger.warn(
      { operation: "xlsx_import_replace_deleted", model: "placeVisit", userId: ctx.userId, deleted: doomed },
      "Spreadsheet import in replace mode deleted visits absent from the file",
    );
  }
  return doomed;
}

// ----------------------------------------------------------------- flights

/** Statuses a spreadsheet may set. Anything else is refused rather than
 *  coerced — silently turning a typo into "flown" changes what is counted. */
const FLIGHT_STATUSES = ["scheduled", "flown", "cancelled", "historical"] as const;

/**
 * Flights, with airports resolved from their IATA codes.
 *
 * The sheet carries codes rather than coordinates, because a code is what a
 * person can type and check. `findOrCreateAirport` turns one into a real
 * airport with a position — the same path the flight form uses, so an
 * imported flight cannot end up in a shape the form would reject.
 *
 * Consequence worth stating: changing a code MOVES the flight. That is the
 * intended way to correct a wrong airport from the table, and the reason an
 * unknown code is refused rather than silently leaving the old position.
 */
async function importFlights(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = index + 2;
    const id = cell.text(raw.id);
    const airline = cell.text(raw.airline);
    const flightNumber = cell.text(raw.flightNumber);
    const label = [airline, flightNumber].filter(Boolean).join(" ") || `#${rowNo}`;

    const status = cell.text(raw.status);
    if (status && !FLIGHT_STATUSES.includes(status as (typeof FLIGHT_STATUSES)[number])) {
      keepDespiteError(seen, id);
      out.push(errorRow(rowNo, label, "invalid_status"));
      continue;
    }

    const departureTime = cell.isoDateTime(raw.departureTime);
    const arrivalTime = cell.isoDateTime(raw.arrivalTime);
    if (departureTime === null || arrivalTime === null) {
      keepDespiteError(seen, id);
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }

    const price = cell.num(raw.price);
    if (price !== undefined && Number.isNaN(price)) {
      keepDespiteError(seen, id);
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }

    // Airports are only touched when the sheet actually carries a code, so an
    // untouched column can never move a flight.
    const depIata = cell.text(raw.depIata);
    const arrIata = cell.text(raw.arrIata);
    let dep: Awaited<ReturnType<typeof findOrCreateAirport>> = null;
    let arr: Awaited<ReturnType<typeof findOrCreateAirport>> = null;
    if (depIata) {
      dep = await findOrCreateAirport(depIata);
      if (!dep) {
        keepDespiteError(seen, id);
        out.push(errorRow(rowNo, label, "unknown_airport"));
        continue;
      }
    }
    if (arrIata) {
      arr = await findOrCreateAirport(arrIata);
      if (!arr) {
        keepDespiteError(seen, id);
        out.push(errorRow(rowNo, label, "unknown_airport"));
        continue;
      }
    }

    const fields: Record<string, unknown> = {
      airline,
      flightNumber,
      status,
      departureTime: departureTime ? new Date(departureTime) : undefined,
      arrivalTime: arrivalTime ? new Date(arrivalTime) : undefined,
      aircraft: cell.text(raw.aircraft),
      aircraftRegistration: cell.text(raw.aircraftRegistration),
      seatNumber: cell.text(raw.seatNumber),
      seatClass: cell.text(raw.seatClass),
      bookingReference: cell.text(raw.bookingReference),
      price,
      currency: cell.text(raw.currency),
      category: cell.text(raw.category),
      notes: cell.text(raw.notes),
      ...(dep
        ? {
            depIata: dep.iata,
            depIcao: dep.icao,
            depName: dep.name,
            depLat: dep.lat,
            depLon: dep.lon,
          }
        : {}),
      ...(arr
        ? {
            arrIata: arr.iata,
            arrIcao: arr.icao,
            arrName: arr.name,
            arrLat: arr.lat,
            arrLon: arr.lon,
          }
        : {}),
    };

    const tripId = cell.ref(raw.tripId);
    if (tripId) {
      const trip = await prisma.trip.findFirst({
        where: { id: tripId, userId: ctx.userId },
        select: { id: true },
      });
      if (!trip) {
        keepDespiteError(seen, id);
        out.push(errorRow(rowNo, label, "unknown_trip"));
        continue;
      }
      fields.tripId = tripId;
    }

    if (id) {
      const existing = await prisma.flight.findFirst({
        where: { id, userId: ctx.userId },
        select: { id: true },
      });
      if (!existing) {
        out.push(errorRow(rowNo, label, UNKNOWN_ID));
        continue;
      }
      seen.add(id);
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id, label, message: "exists" });
        continue;
      }

      const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id, label });
        continue;
      }
      if (!ctx.dryRun) await prisma.flight.update({ where: { id }, data });
      out.push({ row: rowNo, action: "update", id, label });
      continue;
    }

    // A new flight needs a route and an identity. Without those it is not a
    // flight, and the model cannot hold it — the coordinates are non-null.
    if (!dep || !arr || !airline || !flightNumber) {
      out.push(errorRow(rowNo, label, "flight_needs_route"));
      continue;
    }

    let newId: string | null = null;
    if (!ctx.dryRun) {
      const created = await prisma.flight.create({
        data: {
          userId: ctx.userId,
          airline,
          flightNumber,
          depIata: dep.iata,
          depIcao: dep.icao,
          depName: dep.name,
          depLat: dep.lat,
          depLon: dep.lon,
          arrIata: arr.iata,
          arrIcao: arr.icao,
          arrName: arr.name,
          arrLat: arr.lat,
          arrLon: arr.lon,
          departureTime: departureTime ? new Date(departureTime) : null,
          arrivalTime: arrivalTime ? new Date(arrivalTime) : null,
          status: status ?? "flown",
          aircraft: cell.text(raw.aircraft) ?? null,
          seatNumber: cell.text(raw.seatNumber) ?? null,
          bookingReference: cell.text(raw.bookingReference) ?? null,
          price: price ?? null,
          currency: cell.text(raw.currency) ?? null,
          notes: cell.text(raw.notes) ?? null,
          dataSource: "xlsx",
          ...(fields.tripId ? { tripId: fields.tripId as string } : {}),
        },
        select: { id: true },
      });
      newId = created.id;
      seen.add(created.id);
    }
    out.push({ row: rowNo, action: "create", id: newId, label });
  }

  const deleted = await pruneMissing("flight", seen, ctx);
  return summarise(sheet.key, out, deleted);
}

// ------------------------------------------------------------------ router

type Handler = (sheet: IncomingSheet, ctx: Ctx) => Promise<SheetOutcome>;

/** Sheets this importer understands. A sheet key that is not here is ignored
 *  rather than rejected — someone may keep their own tab in the file. */
const HANDLERS: Record<string, Handler> = {
  flights: importFlights,
  // Order matters: places before their visits, so a sheet that creates a place
  // and a visit to it in the same file works in one pass.
  places: importPlaces,
  placeVisits: importPlaceVisits,
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
    // A sheet that is absent, or present but empty, is left alone entirely —
    // including in `replace` mode. Reading an empty sheet as "delete all of
    // this domain" would turn a file someone cleared by accident, or a tab
    // they never filled, into total data loss. Deleting everything has to be
    // asked for by removing the rows one by one, not by handing over a blank.
    if (!sheet || sheet.rows.length === 0) continue;
    if (sheet.rows.length > MAX_ROWS_PER_SHEET) {
      results.push(summarise(key, [errorRow(0, key, "too_many_rows")], 0));
      continue;
    }
    results.push(await HANDLERS[key](sheet, ctx));
  }

  return results;
}
