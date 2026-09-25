/**
 * Rail journeys from a spreadsheet (rail spec; on the 2.7 importer's rules).
 *
 * The rules of every sheet (`importSheets.ts`, `context.ts`): a row whose id
 * names one of the caller's rides updates it; no id, an unknown id or another
 * account's id means the ride is new here — recognised by its natural key
 * (train number + departure day on the boarding station's clock + both
 * station names) when it already is, created otherwise. A row that changes
 * nothing is not written. An unknown travel class or status is left empty and
 * reported, never a reason to refuse the row.
 *
 * Every write goes through the rail write rules (`railJourneyWrite.ts`): the
 * times in the sheet are the STATION's wall clock, as the export writes them,
 * and the server finds each station's zone and stores the real instant; the
 * status and the distance are derived, as they are for a ride typed into the
 * form. A distance travels back only when the sheet says it came from the
 * ticket (`user`); every other figure is measured again.
 */

import { prisma } from "../../db";
import { Prisma, type RailJourney } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import {
  RAIL_STATUSES,
  RAIL_TRAVEL_CLASSES,
  type RailStationInput,
  type UpdateRailJourneyInput,
} from "../../schemas/rail";
import { linkRowsFor, resolveCompanions } from "../companionService";
import { recomputeTripStatus } from "../tripStatusService";
import { fxColumnsFor, getBaseCurrency } from "../fx/snapshot";
import { getCountryResolver, type CountryResolver } from "../geo/countryFromCoordinates";
import { readStoredLine, tracedLengthKm } from "../rail/railGeometry";
import { instantToWallClock, mergeRailJourney, withTracedDistance } from "../rail/railJourneyWrite";
import * as cell from "./cells";
import { MATCHED, type Ctx, definedOnly, errorRow, keepDespiteError, norm } from "./context";
import { pruneMissing } from "./prune";
import { resolveTrip } from "./references";
import { resolveStation, sameStation, stationCells, type RailEnd } from "./railStations";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone, enumCell } from "./values";

const DAY_MS = 86_400_000;

/** A time cell as the station's wall clock `YYYY-MM-DDTHH:mm`, or null when unreadable. */
function wallClock(raw: string | undefined): string | null | undefined {
  const iso = cell.isoTimestamp(raw);
  return iso ? iso.slice(0, 16) : iso;
}

/** The plain columns — no derivation, written as the sheet says. */
function plainFields(raw: Record<string, string>, dropped: DroppedValue[]) {
  return definedOnly({
    operator: cell.text(raw.operator),
    trainCategory: cell.text(raw.trainCategory),
    trainNumber: cell.text(raw.trainNumber),
    travelClass: enumCell(raw.travelClass, RAIL_TRAVEL_CLASSES, "travelClass", dropped),
    coach: cell.text(raw.coach),
    seat: cell.text(raw.seat),
    bookingReference: cell.text(raw.bookingReference),
    delayMinutes: cell.int(raw.delayMinutes),
    price: cell.num(raw.price),
    currency: cell.text(raw.currency)?.toUpperCase(),
    notes: cell.text(raw.notes),
    tags: cell.list(raw.tags),
  });
}

/**
 * What the row asks of the derived columns: stations, clocks, a cancellation
 * and a ticket distance. Only what differs from `stored` (a new ride: all).
 */
async function derivedInput(
  raw: Record<string, string>,
  stored: RailJourney | null,
  cells: Record<RailEnd, ReturnType<typeof stationCells>>,
  countryAt: CountryResolver,
  dropped: DroppedValue[]
): Promise<UpdateRailJourneyInput | "unknown_station"> {
  const input: UpdateRailJourneyInput = {};
  for (const end of ["dep", "arr"] as const) {
    const c = cells[end];
    if (c === "invalid") continue;
    const key = end === "dep" ? "departureStation" : "arrivalStation";
    const storedEnd = stored && {
      name: stored[`${end}StationName`],
      code: stored[`${end}StationCode`],
      lat: stored[`${end}Lat`],
      lon: stored[`${end}Lon`],
    };
    if (storedEnd && sameStation(c, storedEnd)) continue;
    if (!c.name && !c.code && c.lat === undefined) continue;
    const station: RailStationInput | null = await resolveStation(c, countryAt);
    if (!station) return "unknown_station";
    input[key] = station;
  }

  const dep = wallClock(raw.departureTime);
  const arr = wallClock(raw.arrivalTime);
  const storedDep = stored && instantToWallClock(stored.departureTime, stored.depTimezone);
  const storedArr =
    stored?.arrivalTime && instantToWallClock(stored.arrivalTime, stored.arrTimezone);
  if (dep && dep !== storedDep) input.departureLocal = dep;
  if (arr && arr !== storedArr) input.arrivalLocal = arr;

  // Only `cancelled` is a status a person sets; the others are derived from
  // the clocks. A cell naming a derived one on a cancelled ride un-cancels it.
  const status = enumCell(raw.status, RAIL_STATUSES, "status", dropped);
  if (status === "cancelled" && stored?.status !== "cancelled") input.status = "cancelled";
  if (status && status !== "cancelled" && stored?.status === "cancelled") {
    input.status = "scheduled";
  }

  const km = cell.num(raw.distanceKm);
  if (cell.text(raw.distanceSource) === "user" && km !== undefined && !Number.isNaN(km)) {
    if (!(stored?.distanceSource === "user" && Math.round(stored.distanceKm ?? -1) === km)) {
      input.distanceKm = km;
    }
  }
  return input;
}

/** Natural key: same train number, both stations, and the departure day on the boarding clock. */
async function matchRide(
  ctx: Ctx,
  key: { trainNumber?: string; dep?: string; arr?: string; departureDay?: string }
): Promise<RailJourney | null> {
  if (!key.dep || !key.arr || !key.departureDay) return null;
  const day = new Date(`${key.departureDay}T00:00:00.000Z`).getTime();
  const candidates = await prisma.railJourney.findMany({
    where: {
      userId: ctx.userId,
      depStationName: { equals: key.dep, mode: "insensitive" },
      arrStationName: { equals: key.arr, mode: "insensitive" },
      trainNumber: key.trainNumber ? { equals: key.trainNumber, mode: "insensitive" } : null,
      // A day either side covers every zone; the clock test below decides.
      departureTime: { gte: new Date(day - DAY_MS), lt: new Date(day + 2 * DAY_MS) },
      id: { notIn: [...ctx.claimed] },
    },
    orderBy: { createdAt: "asc" },
  });
  return (
    candidates.find(
      (r) => instantToWallClock(r.departureTime, r.depTimezone).slice(0, 10) === key.departureDay
    ) ?? null
  );
}

/** The columns a merge writes, with the frozen line kept only while both stations are. */
function derivedColumns(
  stored: RailJourney | null,
  input: UpdateRailJourneyInput
): Prisma.RailJourneyUncheckedUpdateInput {
  const merged = mergeRailJourney(stored, input);
  const moved = input.departureStation !== undefined || input.arrivalStation !== undefined;
  const line = stored && !moved ? readStoredLine(stored.geometry) : null;
  const state = withTracedDistance(merged, line && tracedLengthKm(line));
  if (!stored || !moved) return state;
  // A station moved: the traced line no longer joins the stations it did.
  return {
    ...state,
    geometry: Prisma.DbNull,
    geometrySource: "straight",
    lookupProvider: null,
    lookupRef: null,
  };
}

async function companionWrites(
  userId: string,
  names: string[] | undefined
): Promise<{ ids: string[]; names: string[] } | undefined> {
  if (names === undefined) return undefined;
  const resolved = await resolveCompanions(userId, names);
  return { ids: resolved.map((c) => c.id), names: resolved.map((c) => c.displayName) };
}

async function writeRide(
  ctx: Ctx,
  targetId: string | null,
  data: Record<string, unknown>,
  companions: { ids: string[]; names: string[] } | undefined
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const payload = { ...data, ...(companions && { companions: companions.names }) };
    const id = targetId
      ? (await tx.railJourney.update({ where: { id: targetId }, data: payload })).id
      : (
          await tx.railJourney.create({
            data: { ...payload, userId: ctx.userId } as Prisma.RailJourneyUncheckedCreateInput,
          })
        ).id;
    if (companions) {
      await tx.railJourneyCompanion.deleteMany({ where: { railJourneyId: id } });
      if (companions.ids.length > 0) {
        await tx.railJourneyCompanion.createMany({
          data: linkRowsFor(companions.ids).map((row) => ({ ...row, railJourneyId: id })),
          skipDuplicates: true,
        });
      }
    }
    return id;
  });
}

export async function importRail(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();
  const countryAt = await getCountryResolver();
  const baseCurrency = await getBaseCurrency(ctx.userId);
  // A ride widens its trip (owner decision 6), so every trip a written ride
  // left or joined is re-derived once, after the sheet.
  const touchedTrips = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const fileId = cell.text(raw.id);
    const label =
      [cell.text(raw.trainCategory), cell.text(raw.trainNumber)].filter(Boolean).join(" ") ||
      [cell.text(raw.depStationName), cell.text(raw.arrStationName)].filter(Boolean).join(" → ") ||
      `#${rowNo}`;
    const refuse = (message: string) => {
      keepDespiteError(seen, fileId);
      out.push(errorRow(rowNo, label, message));
    };

    const departure = wallClock(raw.departureTime);
    if (departure === null || wallClock(raw.arrivalTime) === null) {
      refuse("invalid_date");
      continue;
    }
    const dropped: DroppedValue[] = [];
    const fields = plainFields(raw, dropped);
    if (Number.isNaN(fields.price) || Number.isNaN(fields.delayMinutes)) {
      refuse("invalid_number");
      continue;
    }
    const cells = { dep: stationCells(raw, "dep"), arr: stationCells(raw, "arr") };
    if (cells.dep === "invalid" || cells.arr === "invalid") {
      refuse("invalid_coordinates");
      continue;
    }
    const trip = await resolveTrip(raw.tripId, ctx.userId);
    const notes = trip.note ? [trip.note] : undefined;

    // Scoped by userId: a foreign id misses and the row is new to this account.
    const owned = fileId
      ? await prisma.railJourney.findFirst({ where: { id: fileId, userId: ctx.userId } })
      : null;
    const target =
      owned ??
      (await matchRide(ctx, {
        trainNumber: fields.trainNumber,
        dep: cells.dep.name,
        arr: cells.arr.name,
        departureDay: departure?.slice(0, 10),
      }));
    if (target) {
      ctx.claimed.add(target.id);
      seen.add(target.id);
      if (ctx.mode === "add") {
        out.push({ row: rowNo, action: "skip", id: target.id, label, message: "exists" });
        continue;
      }
    }

    const input = await derivedInput(raw, target, cells, countryAt, dropped);
    if (input === "unknown_station") {
      refuse("unknown_station");
      continue;
    }
    if (!target && (!input.departureStation || !input.arrivalStation || !input.departureLocal)) {
      refuse("rail_needs_route");
      continue;
    }

    let derived: Prisma.RailJourneyUncheckedUpdateInput;
    try {
      derived = Object.keys(input).length > 0 || !target ? derivedColumns(target, input) : {};
    } catch (err) {
      // An arrival before the departure, the one rule the merge refuses.
      if (err instanceof AppError) {
        refuse("invalid_date");
        continue;
      }
      throw err;
    }
    const incoming: Record<string, unknown> = {
      ...fields,
      ...derived,
      ...(trip.tripId !== undefined && { tripId: trip.tripId }),
    };
    const companionNames = cell.list(raw.companions);
    const data: Record<string, unknown> = target ? changedOnly(incoming, target) : incoming;
    const companionsChanged =
      companionNames !== undefined &&
      (!target || Object.keys(changedOnly({ companions: companionNames }, target)).length > 0);
    const extra = { notes, dropped: droppedOrNone(dropped) };
    const message = target && !owned ? MATCHED : undefined;

    if (target && Object.keys(data).length === 0 && !companionsChanged) {
      out.push({ row: rowNo, action: "skip", id: target.id, label, message, ...extra });
      continue;
    }
    const departureTime = (derived.departureTime as Date | undefined) ?? target?.departureTime;
    if ("price" in data || "currency" in data || "departureTime" in data) {
      Object.assign(
        data,
        await fxColumnsFor(
          {
            amount: fields.price !== undefined ? fields.price : (target?.price ?? null),
            currency: fields.currency ?? target?.currency ?? null,
            date: departureTime ?? null,
          },
          baseCurrency
        )
      );
    }

    let id: string | null = target?.id ?? null;
    if (!ctx.dryRun) {
      const companions = companionsChanged
        ? await companionWrites(ctx.userId, companionNames)
        : undefined;
      id = await writeRide(ctx, target?.id ?? null, data, companions);
      for (const t of [target?.tripId, data.tripId]) if (typeof t === "string") touchedTrips.add(t);
      seen.add(id);
      ctx.claimed.add(id);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: target ? "update" : "create", id, label, message, ...extra });
  }

  for (const tripId of touchedTrips) await recomputeTripStatus(tripId);
  const deleted = await pruneMissing("railJourney", seen, ctx);
  return summarise(sheet.key, out, deleted);
}
