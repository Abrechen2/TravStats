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
import {
  flightFxColumnsIfChanged,
  flightFxColumnsForCreate,
  findFlightForFxMerge,
} from "./fxSnapshot";
import * as cell from "./cells";
import { MATCHED, type Ctx, dayRange, definedOnly, errorRow, keepDespiteError } from "./context";
import { pruneMissing } from "./prune";
import { resolveTrip } from "./references";
import { summarise, type IncomingSheet, type RowOutcome, type SheetOutcome } from "./types";

/** Statuses a spreadsheet may set. Anything else is refused rather than
 *  coerced — silently turning a typo into "flown" changes what is counted. */
const FLIGHT_STATUSES = ["scheduled", "flown", "cancelled", "historical"] as const;

type Airport = NonNullable<Awaited<ReturnType<typeof findOrCreateAirport>>>;

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
    const rowNo = index + 2;
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

    const fields: Record<string, unknown> = {
      airline,
      flightNumber,
      status,
      departureTime: departureTimeValue,
      arrivalTime: arrivalTime ? new Date(arrivalTime) : undefined,
      aircraft: cell.text(raw.aircraft),
      aircraftRegistration: cell.text(raw.aircraftRegistration),
      seatNumber: cell.text(raw.seatNumber),
      seatClass: cell.text(raw.seatClass),
      bookingReference: cell.text(raw.bookingReference),
      price,
      currency,
      category: cell.text(raw.category),
      notes: cell.text(raw.notes),
      tripId: trip.tripId,
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

    // Scoped by userId inside `findFlightForFxMerge`: a foreign id misses and
    // the row is treated as a new flight of this account.
    const owned = fileId ? await findFlightForFxMerge(fileId, ctx.userId) : null;
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
      const existing = owned ?? (await findFlightForFxMerge(targetId, ctx.userId));
      // FX snapshot (fix round 1, finding 3) — see `xlsxImport/fxSnapshot.ts`.
      if (existing) {
        Object.assign(
          fields,
          await flightFxColumnsIfChanged(
            ctx.userId,
            { price, currency, departureTime: departureTimeValue },
            existing
          )
        );
      }
      const data = definedOnly(fields);
      if (Object.keys(data).length === 0) {
        out.push({ row: rowNo, action: "skip", id: targetId, label, notes });
        continue;
      }
      if (!ctx.dryRun) await prisma.flight.update({ where: { id: targetId }, data });
      ctx.wrote = ctx.wrote || !ctx.dryRun;
      out.push({ row: rowNo, action: "update", id: targetId, label, message, notes });
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
          departureTime: departureTimeValue ?? null,
          arrivalTime: arrivalTime ? new Date(arrivalTime) : null,
          status: status ?? "flown",
          aircraft: cell.text(raw.aircraft) ?? null,
          aircraftRegistration: cell.text(raw.aircraftRegistration) ?? null,
          seatNumber: cell.text(raw.seatNumber) ?? null,
          seatClass: cell.text(raw.seatClass) ?? null,
          bookingReference: cell.text(raw.bookingReference) ?? null,
          category: cell.text(raw.category) ?? null,
          price: price ?? null,
          currency: currency ?? null,
          notes: cell.text(raw.notes) ?? null,
          dataSource: "xlsx",
          ...newFxColumns,
          ...(trip.tripId ? { tripId: trip.tripId } : {}),
        },
        select: { id: true },
      });
      newId = created.id;
      seen.add(created.id);
      ctx.claimed.add(created.id);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: "create", id: newId, label, notes });
  }

  const deleted = await pruneMissing("flight", seen, ctx);
  return summarise(sheet.key, out, deleted);
}
