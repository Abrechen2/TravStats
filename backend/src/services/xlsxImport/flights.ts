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
 *
 * Natural key for a row without an id of this account: flight number + route
 * + departure day (UTC). A flight number alone is not unique on one day, the
 * route is what separates the two legs of a same-number rotation.
 */

import { prisma } from "../../db";
import { findOrCreateAirport } from "../airportLookup";
import { flightFxColumnsIfChanged, flightFxColumnsForCreate, fxRefreshNote } from "./fxSnapshot";
import * as cell from "./cells";
import { MATCHED, type Ctx, dayRange, definedOnly, errorRow, keepDespiteError } from "./context";
import { pruneMissing } from "./prune";
import { resolveTrip } from "./references";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone, enumCell } from "./values";
import { companionsDiffer, resolveCompanionCell, updateWithCompanions } from "./companionLinks";
import { linkRowsFor } from "../companionService";
import { zoneOf } from "../../shared/time/zoneOf";

/** Statuses a spreadsheet may set. Anything else is refused rather than
 *  coerced — silently turning a typo into "flown" changes what is counted, and
 *  status is the one enum here that cannot be left empty: a new flight without
 *  one would be "flown" by default, which is the guess this refusal prevents.
 *  `duplicated` is a stored passthrough status, so an export carries it. */
const FLIGHT_STATUSES = ["scheduled", "flown", "cancelled", "historical", "duplicated"] as const;
/** The optional enum columns — unknown text is left empty, the row applied. */
const SEAT_CLASSES = ["economy", "premium_economy", "business", "first"] as const;
const CATEGORIES = ["business", "private", "vacation"] as const;

type Airport = NonNullable<Awaited<ReturnType<typeof findOrCreateAirport>>>;

/** The position columns of one end of a flight, from its airport. */
function airportColumns(end: "dep" | "arr", a: Airport): Record<string, unknown> {
  return {
    [`${end}Iata`]: a.iata,
    [`${end}Icao`]: a.icao,
    [`${end}Name`]: a.name,
    [`${end}Lat`]: a.lat,
    [`${end}Lon`]: a.lon,
    // The zone the end is read in, frozen with the airport (ADR 0002).
    [`${end}Timezone`]: zoneOf({ catalogueZone: a.timezone, lat: a.lat, lon: a.lon }),
  };
}

async function matchFlight(
  ctx: Ctx,
  key: { flightNumber?: string; dep: Airport | null; arr: Airport | null; departure?: string }
): Promise<string | null> {
  if (!key.flightNumber || !key.dep || !key.arr || !key.departure) return null;
  const hit = await prisma.flight.findFirst({
    where: {
      userId: ctx.userId,
      flightNumber: { equals: key.flightNumber, mode: "insensitive" },
      depIata: key.dep.iata,
      arrIata: key.arr.iata,
      departureTime: dayRange(key.departure) ?? undefined,
      id: { notIn: [...ctx.claimed] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return hit?.id ?? null;
}

export async function importFlights(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const fileId = cell.text(raw.id);
    const airline = cell.text(raw.airline);
    const flightNumber = cell.text(raw.flightNumber);
    const label = [airline, flightNumber].filter(Boolean).join(" ") || `#${rowNo}`;

    const status = cell.text(raw.status);
    if (status && !FLIGHT_STATUSES.includes(status as (typeof FLIGHT_STATUSES)[number])) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_status"));
      continue;
    }

    const departureTime = cell.isoDateTime(raw.departureTime);
    const arrivalTime = cell.isoDateTime(raw.arrivalTime);
    if (departureTime === null || arrivalTime === null) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_date"));
      continue;
    }

    const price = cell.num(raw.price);
    if (price !== undefined && Number.isNaN(price)) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "invalid_number"));
      continue;
    }
    const currency = cell.text(raw.currency);
    const departureTimeValue = departureTime ? new Date(departureTime) : undefined;

    // Airports are only touched when the sheet actually carries a code, so an
    // untouched column can never move a flight.
    const depIata = cell.text(raw.depIata);
    const arrIata = cell.text(raw.arrIata);
    const dep = depIata ? await findOrCreateAirport(depIata) : null;
    const arr = arrIata ? await findOrCreateAirport(arrIata) : null;
    if ((depIata && !dep) || (arrIata && !arr)) {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, "unknown_airport"));
      continue;
    }

    const trip = await resolveTrip(raw.tripId, ctx.userId);
    const notes = trip.note ? [trip.note] : undefined;
    const dropped: DroppedValue[] = [];
    const seatClass = enumCell(raw.seatClass, SEAT_CLASSES, "seatClass", dropped);
    const category = enumCell(raw.category, CATEGORIES, "category", dropped);
    const extra = { notes, dropped: droppedOrNone(dropped) };
    // Companions are written as the form writes them — names AND link rows.
    const companionNames = cell.list(raw.companions);

    const fields: Record<string, unknown> = {
      airline,
      flightNumber,
      status,
      departureTime: departureTimeValue,
      arrivalTime: arrivalTime ? new Date(arrivalTime) : undefined,
      aircraft: cell.text(raw.aircraft),
      aircraftRegistration: cell.text(raw.aircraftRegistration),
      seatNumber: cell.text(raw.seatNumber),
      seatClass,
      bookingReference: cell.text(raw.bookingReference),
      price,
      currency,
      category,
      notes: cell.text(raw.notes),
      tags: cell.list(raw.tags),
      tripId: trip.tripId,
      // The code is what the sheet says; the airport columns follow it only
      // when it changed (below), so an untouched code never moves a flight.
      depIata: dep?.iata,
      arrIata: arr?.iata,
    };

    // Scoped by userId: a foreign id misses and the row is treated as a new
    // flight of this account.
    const owned = fileId
      ? await prisma.flight.findFirst({ where: { id: fileId, userId: ctx.userId } })
      : null;
    const targetId =
      owned?.id ?? (await matchFlight(ctx, { flightNumber, dep, arr, departure: departureTime }));

    if (targetId) {
      ctx.claimed.add(targetId);
      seen.add(targetId);
      const message = owned ? undefined : MATCHED;
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message: "exists" });
        continue;
      }
      const stored = owned ?? (await prisma.flight.findUniqueOrThrow({ where: { id: targetId } }));
      const data: Record<string, unknown> = changedOnly(definedOnly(fields), stored);
      const companionsChanged = companionsDiffer(companionNames, stored);
      if (Object.keys(data).length === 0 && !companionsChanged) {
        out.push({ row: rowNo, action: "skip", id: targetId, label, message, ...extra });
        continue;
      }
      if (dep && "depIata" in data) Object.assign(data, airportColumns("dep", dep));
      if (arr && "arrIata" in data) Object.assign(data, airportColumns("arr", arr));
      // The sheet's times are real instants (flights are UTC since the repair).
      if ("departureTime" in data) data.depPrecision = departureTimeValue ? "minute" : null;
      if ("arrivalTime" in data) data.arrPrecision = arrivalTime ? "minute" : null;
      // FX snapshot (fix round 1, finding 3) — see `xlsxImport/fxSnapshot.ts`.
      // Only when a column it reads actually changed; a failed lookup keeps
      // the stored rate and says so on the row.
      let fxNote: string | null = null;
      if ("price" in data || "currency" in data || "departureTime" in data) {
        const fx = await flightFxColumnsIfChanged(
          ctx.userId,
          { price, currency, departureTime: departureTimeValue },
          stored
        );
        Object.assign(data, fx.columns);
        fxNote = fxRefreshNote(fx);
      }
      if (!ctx.dryRun) {
        const companions = companionsChanged
          ? await resolveCompanionCell(ctx.userId, companionNames)
          : undefined;
        await updateWithCompanions("flight", targetId, data, companions);
      }
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      const rowNotes = fxNote ? [...(extra.notes ?? []), fxNote] : extra.notes;
      out.push({
        row: rowNo,
        action: "update",
        id: targetId,
        label,
        message,
        ...extra,
        notes: rowNotes,
      });
      continue;
    }

    // A new flight needs a route and an identity. Without those it is not a
    // flight, and the model cannot hold it — the coordinates are non-null.
    if (!dep || !arr || !airline || !flightNumber) {
      out.push(errorRow(rowNo, label, "flight_needs_route"));
      continue;
    }

    // FX snapshot on create too — see `flightFxColumnsForCreate`.
    const newFxColumns = await flightFxColumnsForCreate(ctx.userId, {
      price,
      currency,
      departureTime: departureTimeValue,
    });

    let newId: string | null = null;
    if (!ctx.dryRun) {
      const companions = await resolveCompanionCell(ctx.userId, companionNames);
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.flight.create({
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
            departureTime: departureTimeValue ?? null,
            arrivalTime: arrivalTime ? new Date(arrivalTime) : null,
            depTimezone: airportColumns("dep", dep).depTimezone as string | null,
            arrTimezone: airportColumns("arr", arr).arrTimezone as string | null,
            depPrecision: departureTimeValue ? "minute" : null,
            arrPrecision: arrivalTime ? "minute" : null,
            status: status ?? "flown",
            aircraft: cell.text(raw.aircraft) ?? null,
            aircraftRegistration: cell.text(raw.aircraftRegistration) ?? null,
            seatNumber: cell.text(raw.seatNumber) ?? null,
            seatClass: seatClass ?? null,
            bookingReference: cell.text(raw.bookingReference) ?? null,
            category: category ?? null,
            price: price ?? null,
            currency: currency ?? null,
            notes: cell.text(raw.notes) ?? null,
            dataSource: "xlsx",
            tags: cell.list(raw.tags) ?? [],
            companions: companions?.names ?? [],
            ...newFxColumns,
            ...(trip.tripId ? { tripId: trip.tripId } : {}),
          },
          select: { id: true },
        });
        if (companions && companions.ids.length > 0) {
          await tx.flightCompanion.createMany({
            data: linkRowsFor(companions.ids).map((link) => ({ ...link, flightId: row.id })),
            skipDuplicates: true,
          });
        }
        return row;
      });
      newId = created.id;
      seen.add(created.id);
      ctx.claimed.add(created.id);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: "create", id: newId, label, ...extra });
  }

  const deleted = await pruneMissing("flight", seen, ctx);
  return summarise(sheet.key, out, deleted);
}
