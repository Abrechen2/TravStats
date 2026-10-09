/**
 * Rentals from a spreadsheet (forgejo#267), on the rules every sheet follows
 * (`importSheets.ts`, `context.ts`): a row whose id names one of the caller's
 * rentals updates it; no id, an unknown id or another account's id means the
 * rental is new here — recognised by provider + booking number (else provider
 * + pickup station + pickup day on that station's clock) when it already is,
 * created otherwise. A row that changes nothing is not written, so reading the
 * same file twice converges.
 *
 * Every write goes through the rental write path (`rentalRowWrite.ts`): the
 * station clocks, the zones, return after pickup, the odometer and deposit
 * rules, FX. A dry run runs the same rules without writing. Unknown stays
 * unknown: a blank cell leaves the field as it is, never 0.
 */

import { prisma } from "../../db";
import type { Prisma, RentalBooking } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { createRentalSchema, type UpdateRentalInput } from "../../schemas/rental";
import { partialForUpdate } from "../../schemas/partialUpdate";
import { createRentalRow, resolveStations, updateRentalRow } from "../rental/rentalRowWrite";
import { assertDepositConsistent, assertOdometerOrder, mergeRental } from "../rental/rentalWrite";
import { fromDbDate } from "../../shared/time/localDate";
import { localDay, toInstant, toLocal } from "../../shared/time/instant";
import * as cell from "./cells";
import { MATCHED, type Ctx, errorRow, keepDespiteError } from "./context";
import { pruneMissing } from "./prune";
import { refName, resolveTrip } from "./references";
import {
  RENTAL_TIME_ENDS,
  dayCell,
  distanceCells,
  finalCells,
  plainCells,
  sheetStation,
  sheetTime,
  stationBody,
  statusCell,
  type RentalTimeEnd,
  type SheetStation,
  type SheetTime,
} from "./rentalCells";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone } from "./values";

type Body = Record<string, unknown>;

/** The rental refusals by code, as the preview words them. */
const REFUSALS: Record<string, string> = {
  RENTAL_STATION_UNRESOLVED: "unknown_rental_station",
  TZ_UNRESOLVED: "unknown_rental_station",
  // Transient: the address search did not answer — never "not found".
  RENTAL_GEOCODER_UNAVAILABLE: "geocoder_unavailable",
  LOCAL_TIME_NONEXISTENT: "nonexistent_time",
  RENTAL_RETURN_BEFORE_PICKUP: "rental_order",
  RENTAL_ACTUAL_RETURN_BEFORE_PICKUP: "rental_order",
  RENTAL_DEPOSIT_RETURNED_BEFORE_PAID: "deposit_order",
  RENTAL_ODOMETER_REVERSED: "odometer_order",
  RENTAL_DEPOSIT_RETURN_EXCEEDS: "deposit_return_exceeds",
};

const zoneOf = (r: RentalBooking, end: RentalTimeEnd): string =>
  end === "pickup" || end === "actualPickup" ? r.pickupTimezone : r.returnTimezone;

/** A stored end in the sheet's own terms: wall clock (or day) and occurrence. */
function storedTime(r: RentalBooking, end: RentalTimeEnd): SheetTime | null {
  const utc = {
    pickup: r.pickupTime,
    return: r.returnTime,
    actualPickup: r.actualPickupTime,
    actualReturn: r.actualReturnTime,
  }[end];
  if (!utc) return null;
  const precision = {
    pickup: r.pickupPrecision,
    return: r.returnPrecision,
    actualPickup: r.actualPickupPrecision ?? "minute",
    actualReturn: r.actualReturnPrecision ?? "minute",
  }[end];
  const zone = zoneOf(r, end);
  const local = toLocal(utc, zone).local;
  if (precision === "day") return { wall: local.slice(0, 10), fold: "earlier" };
  const wall = local.slice(0, 16);
  const later = toInstant(wall, zone, { origin: "machine", fold: "later" });
  return {
    wall,
    fold: later.ambiguous && later.utc.getTime() === utc.getTime() ? "later" : "earlier",
  };
}

const sameTime = (a: SheetTime | undefined, b: SheetTime | null): boolean =>
  a !== undefined && b !== null && a.wall === b.wall && a.fold === b.fold;

function sameStation(s: SheetStation, r: RentalBooking, end: "pickup" | "return"): boolean {
  const name = end === "pickup" ? r.pickupStationName : r.returnStationName;
  const lat = end === "pickup" ? r.pickupLat : r.returnLat;
  const lon = end === "pickup" ? r.pickupLon : r.returnLon;
  const near = (a: number | undefined, b: number) => a === undefined || Math.abs(a - b) < 1e-6;
  return (
    (s.name ?? "").toLowerCase() === name.toLowerCase() && near(s.lat, lat) && near(s.lon, lon)
  );
}

/** Natural key: provider + booking number; without one, provider + pickup station + day. */
async function matchRental(
  ctx: Ctx,
  key: { provider?: string; confirmation?: string; station?: string; pickupDay?: string }
): Promise<RentalBooking | null> {
  if (!key.provider) return null;
  const base = {
    userId: ctx.userId,
    provider: { equals: key.provider, mode: "insensitive" as const },
    id: { notIn: [...ctx.claimed] },
  };
  if (key.confirmation) {
    return prisma.rentalBooking.findFirst({
      where: { ...base, confirmationNumber: { equals: key.confirmation, mode: "insensitive" } },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!key.station || !key.pickupDay) return null;
  const candidates = await prisma.rentalBooking.findMany({
    where: { ...base, pickupStationName: { equals: key.station, mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });
  return candidates.find((r) => localDay(r.pickupTime, r.pickupTimezone) === key.pickupDay) ?? null;
}

/** A roadtrip reference: own id, else one roadtrip of exactly that name. */
async function resolveRoadtrip(
  raw: string | undefined,
  userId: string
): Promise<{ routeId?: string; note?: string }> {
  const id = cell.ref(raw);
  const name = refName(raw);
  if (!id && !name) return {};
  if (id) {
    const own = await prisma.tripRoute.findFirst({
      where: { id, userId, kind: "roadtrip" },
      select: { id: true },
    });
    if (own) return { routeId: own.id };
  }
  if (name) {
    const byName = await prisma.tripRoute.findMany({
      where: { userId, kind: "roadtrip", name: { equals: name, mode: "insensitive" } },
      select: { id: true },
      take: 2,
    });
    if (byName.length === 1) return { routeId: byName[0].id };
  }
  return { note: "roadtrip_not_linked" };
}

interface ReadRow {
  plain: ReturnType<typeof plainCells>;
  times: Partial<Record<RentalTimeEnd, SheetTime>>;
  stations: { pickup: SheetStation; return: SheetStation };
  depositPaidOn?: string;
  depositReturnedOn?: string;
  status?: string;
  distance: ReturnType<typeof distanceCells>;
  final: ReturnType<typeof finalCells>;
  companions?: string[];
}

/** The cells, or the refusal code of the first unreadable one. */
function readRow(raw: Record<string, string>, dropped: DroppedValue[]): ReadRow | string {
  const plain = plainCells(raw, dropped);
  const distance = distanceCells(raw, dropped);
  const final = finalCells(raw, dropped);
  const numbers = [
    plain.odometerOutKm,
    plain.odometerInKm,
    plain.mileageCapKm,
    plain.price,
    plain.depositAmount,
    plain.depositReturnedAmount,
    distance.km,
    final.amount,
  ];
  if (numbers.some((n) => Number.isNaN(n))) return "invalid_number";
  const times: ReadRow["times"] = {};
  for (const end of RENTAL_TIME_ENDS) {
    const time = sheetTime(raw, end, dropped);
    if (time === "invalid") return "invalid_date";
    if (time) times[end] = time;
  }
  const paid = dayCell(raw.depositPaidOn);
  const returned = dayCell(raw.depositReturnedOn);
  if (paid === null || returned === null) return "invalid_date";
  const pickup = sheetStation(raw, "pickup");
  const ret = sheetStation(raw, "return");
  if (pickup === "invalid" || ret === "invalid") return "invalid_coordinates";
  return {
    plain,
    times,
    stations: { pickup, return: ret },
    depositPaidOn: paid,
    depositReturnedOn: returned,
    status: statusCell(raw.status, dropped),
    distance,
    final,
    companions: cell.list(raw.companions),
  };
}

/** The write body: everything for a new rental, only what differs for a stored one. */
function bodyFor(row: ReadRow, target: RentalBooking | null): Body {
  const body: Body = {};
  const { plain, final, distance } = row;
  Object.assign(body, target ? changedOnly(plain, target) : plain);

  for (const [key, day] of [
    ["depositPaidOn", row.depositPaidOn],
    ["depositReturnedOn", row.depositReturnedOn],
  ] as const) {
    const stored = target?.[key];
    if (day !== undefined && day !== (stored ? fromDbDate(stored) : null)) body[key] = day;
  }

  const pickup = row.stations.pickup;
  const ret = row.stations.return;
  if (!target || !sameStation(pickup, target, "pickup")) {
    const station = stationBody(pickup);
    if (station) body.pickupStation = station;
  }
  const returnSameAsPickup =
    !ret.name ||
    (ret.name.toLowerCase() === (pickup.name ?? "").toLowerCase() &&
      ret.lat === pickup.lat &&
      ret.lon === pickup.lon);
  if (!target || !sameStation(ret, target, "return")) {
    body.returnStation = returnSameAsPickup ? null : stationBody(ret);
    if (target && returnSameAsPickup && sameStation(pickup, target, "return")) {
      delete body.returnStation;
    }
  }

  for (const end of RENTAL_TIME_ENDS) {
    const time = row.times[end];
    if (!time || (target && sameTime(time, storedTime(target, end)))) continue;
    body[`${end}Local`] = time.wall;
    if (time.wall.length > 10) body[`${end}Fold`] = time.fold;
  }

  // Only `cancelled` is a status a person sets; the rest come from the clock.
  if (row.status === "cancelled" && target?.status !== "cancelled") body.status = "cancelled";
  if (row.status && row.status !== "cancelled" && target?.status === "cancelled") {
    body.status = "scheduled";
  }

  if (distance.km !== undefined && distance.km !== target?.distanceKm) {
    body.distanceKm = distance.km;
  }
  if (final.amount !== undefined) {
    const sameAmount =
      final.amount === target?.finalAmount && (final.currency ?? null) === target?.finalCurrency;
    if (!sameAmount) {
      body.finalAmount = final.amount;
      body.finalCurrency = final.currency ?? null;
    }
  }
  if (
    row.companions !== undefined &&
    (!target || changedOnly({ companions: row.companions }, target).companions)
  ) {
    body.companions = row.companions;
  }
  return body;
}

/**
 * The columns only a document writes, carried so a moved rental keeps them:
 * an invoice's km stay the invoice's, a cancellation fee stays a fee.
 */
function sourceColumns(
  row: ReadRow,
  body: Body
): Partial<Prisma.RentalBookingUncheckedCreateInput> {
  return {
    ...("distanceKm" in body &&
      (row.distance.source === "invoice" || row.distance.source === "agreement") && {
        distanceSource: row.distance.source,
      }),
    ...("finalAmount" in body &&
      (row.final.source === "invoice" || row.final.source === "cancellationFee") && {
        finalAmountSource: row.final.source,
      }),
  };
}

/** The rental rules without a write — what a dry run must refuse exactly as the write would. */
async function validateOnly(target: RentalBooking | null, input: UpdateRentalInput): Promise<void> {
  mergeRental(target, input, await resolveStations(input));
  assertOdometerOrder(target, input);
  assertDepositConsistent(target, input);
}

/** Any subset of the create body — the sheet decides what changed. */
const updateBodySchema = partialForUpdate(createRentalSchema);

export async function importRentals(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const fileId = cell.text(raw.id);
    const label =
      [cell.text(raw.provider), cell.text(raw.confirmationNumber)].filter(Boolean).join(" ") ||
      cell.text(raw.pickupStationName) ||
      `#${rowNo}`;
    const refuse = (message: string) => {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, message));
    };

    const dropped: DroppedValue[] = [];
    const row = readRow(raw, dropped);
    if (typeof row === "string") {
      refuse(row);
      continue;
    }
    const trip = await resolveTrip(raw.tripId, ctx.userId);
    const route = await resolveRoadtrip(raw.routeId, ctx.userId);
    const notes = [trip.note, route.note].filter((n): n is string => Boolean(n));

    // Scoped by userId: a foreign id misses and the row is new to this account.
    const owned = fileId
      ? await prisma.rentalBooking.findFirst({ where: { id: fileId, userId: ctx.userId } })
      : null;
    const target =
      owned ??
      (await matchRental(ctx, {
        provider: row.plain.provider,
        confirmation: row.plain.confirmationNumber,
        station: row.stations.pickup.name,
        pickupDay: row.times.pickup?.wall.slice(0, 10),
      }));
    if (target) {
      ctx.claimed.add(target.id);
      seen.add(target.id);
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: target.id, label, message: "exists" });
        continue;
      }
    }

    const body = bodyFor(row, target);
    if (trip.tripId !== undefined ? trip.tripId !== target?.tripId : !target && !trip.note) {
      body.tripId = trip.tripId ?? null;
    }
    if (route.routeId !== undefined && route.routeId !== target?.routeId)
      body.routeId = route.routeId;

    const extra = { notes: notes.length > 0 ? notes : undefined, dropped: droppedOrNone(dropped) };
    const message = target && !owned ? MATCHED : undefined;
    if (target && Object.keys(body).length === 0) {
      out.push({ row: rowNo, action: "skip", id: target.id, label, message, ...extra });
      continue;
    }
    if (
      !target &&
      (!body.provider || !body.pickupStation || !body.pickupLocal || !body.returnLocal)
    ) {
      refuse("rental_needs_booking");
      continue;
    }
    const parsed = target ? updateBodySchema.safeParse(body) : createRentalSchema.safeParse(body);
    if (!parsed.success) {
      refuse("invalid_row");
      continue;
    }
    const input = parsed.data as UpdateRentalInput;

    let id: string | null = target?.id ?? null;
    try {
      if (ctx.dryRun) {
        await validateOnly(target, input);
      } else {
        const columns = sourceColumns(row, body);
        const written = target
          ? await updateRentalRow(ctx.userId, target, input, { manual: true, extra: columns })
          : await createRentalRow(ctx.userId, createRentalSchema.parse(body), {
              manual: true,
              extra: columns,
            });
        id = written.id;
        seen.add(id);
        ctx.claimed.add(id);
        ctx.wrote = true;
      }
    } catch (err) {
      if (err instanceof AppError) {
        refuse(REFUSALS[err.code ?? ""] ?? "invalid_row");
        continue;
      }
      throw err;
    }
    out.push({ row: rowNo, action: target ? "update" : "create", id, label, message, ...extra });
  }

  const deleted = await pruneMissing("rentalBooking", seen, ctx);
  return summarise(sheet.key, out, deleted);
}
