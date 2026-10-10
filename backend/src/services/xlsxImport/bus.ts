/**
 * Bus rides from a spreadsheet (forgejo#180) — the round trip of the bus sheet
 * the export writes (`frontend/src/lib/xlsx/busSheet.ts`), on every sheet's
 * rules (`importSheets.ts`, `context.ts`): a row whose id names one of the
 * caller's rides updates it; no id, an unknown id or another account's id
 * means the ride is new here — recognised by its natural key (both terminal
 * names + the departure day on the departure terminal's clock) when it
 * already is, created otherwise. A row that changes nothing is not written.
 * An unknown ride kind or status is left empty and reported, never a reason to
 * refuse the row.
 *
 * Every write goes through the bus write rules (`mergeBusJourney`): the times
 * in the sheet are the TERMINAL's wall clock, as the export writes them; the
 * server finds each terminal's zone from its coordinates and stores the real
 * instant; status and distance are derived, as for a ride typed into the
 * form. A distance travels back only when the sheet says it came from the
 * ticket (`user`).
 */

import { prisma } from "../../db";
import { Prisma, type BusJourney } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { BUS_RIDE_KINDS, BUS_STATUSES, type UpdateBusJourneyInput } from "../../schemas/bus";
import { mergeBusJourney } from "../bus/busJourneyWrite";
import { instantToWallClock } from "../rail/railJourneyWrite";
import { linkRowsFor, resolveCompanions } from "../companionService";
import { recomputeTripStatus } from "../tripStatusService";
import { fxColumnsFor, getBaseCurrency } from "../fx/snapshot";
import * as cell from "./cells";
import { MATCHED, type Ctx, definedOnly, errorRow, keepDespiteError } from "./context";
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

const DAY_MS = 86_400_000;
type End = "dep" | "arr";

/** A time cell as the terminal's wall clock `YYYY-MM-DDTHH:mm`, or null when unreadable. */
function wallClock(raw: string | undefined): string | null | undefined {
  const iso = cell.isoTimestamp(raw);
  return iso ? iso.slice(0, 16) : iso;
}

interface TerminalCells {
  name?: string;
  address?: string;
  lat?: number;
  lon?: number;
  country?: string;
}

/** A terminal's cells, or "invalid" when a coordinate is unreadable or only one is given. */
function terminalCells(raw: Record<string, string>, end: End): TerminalCells | "invalid" {
  const lat = cell.num(raw[`${end}Lat`]);
  const lon = cell.num(raw[`${end}Lon`]);
  if (Number.isNaN(lat) || Number.isNaN(lon) || (lat === undefined) !== (lon === undefined)) {
    return "invalid";
  }
  if (lat !== undefined && (Math.abs(lat) > 90 || Math.abs(lon as number) > 180)) return "invalid";
  return {
    name: cell.text(raw[`${end}StationName`]),
    address: cell.text(raw[`${end}Address`]),
    lat,
    lon,
    country: cell.text(raw[`${end}Country`])?.toUpperCase(),
  };
}

/** The plain columns — no derivation, written as the sheet says. */
function plainFields(raw: Record<string, string>, dropped: DroppedValue[]) {
  return definedOnly({
    operator: cell.text(raw.operator),
    lineName: cell.text(raw.lineName),
    rideKind: enumCell(raw.rideKind, BUS_RIDE_KINDS, "rideKind", dropped),
    fareClass: cell.text(raw.fareClass),
    seat: cell.text(raw.seat),
    bookingReference: cell.text(raw.bookingReference),
    delayMinutes: cell.int(raw.delayMinutes),
    price: cell.num(raw.price),
    currency: cell.text(raw.currency)?.toUpperCase(),
    notes: cell.text(raw.notes),
    tags: cell.list(raw.tags),
  });
}

/** What the row asks of the derived columns; only what differs from `stored` (a new ride: all). */
function derivedInput(
  raw: Record<string, string>,
  stored: BusJourney | null,
  cells: Record<End, TerminalCells>,
  dropped: DroppedValue[]
): UpdateBusJourneyInput | "needs_coordinates" {
  const input: UpdateBusJourneyInput = {};
  for (const end of ["dep", "arr"] as const) {
    const c = cells[end];
    const key = end === "dep" ? "departureStation" : "arrivalStation";
    const same =
      stored &&
      (c.name ?? stored[`${end}StationName`]) === stored[`${end}StationName`] &&
      (c.lat === undefined ||
        (Math.abs(c.lat - stored[`${end}Lat`]) < 1e-6 &&
          Math.abs((c.lon as number) - stored[`${end}Lon`]) < 1e-6));
    if (same) continue;
    // A bus terminal has no catalogue: without coordinates it cannot be placed.
    if (!c.name || c.lat === undefined || c.lon === undefined) {
      if (!stored && !c.name && c.lat === undefined) continue;
      return "needs_coordinates";
    }
    input[key] = {
      name: c.name,
      address: c.address ?? null,
      lat: c.lat,
      lon: c.lon,
      country: c.country && /^[A-Z]{2}$/.test(c.country) ? c.country : null,
    };
  }

  const dep = wallClock(raw.departureTime);
  const arr = wallClock(raw.arrivalTime);
  const storedDep = stored && instantToWallClock(stored.departureTime, stored.depTimezone);
  const storedArr =
    stored?.arrivalTime && instantToWallClock(stored.arrivalTime, stored.arrTimezone);
  if (dep && dep !== storedDep) input.departureLocal = dep;
  if (arr && arr !== storedArr) input.arrivalLocal = arr;

  // Only `cancelled` is set by a person; a derived status on a cancelled ride un-cancels it.
  const status = enumCell(raw.status, BUS_STATUSES, "status", dropped);
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

/** Natural key: both terminal names and the departure day on the departure clock. */
async function matchRide(
  ctx: Ctx,
  key: { dep?: string; arr?: string; departureDay?: string }
): Promise<BusJourney | null> {
  if (!key.dep || !key.arr || !key.departureDay) return null;
  const day = new Date(`${key.departureDay}T00:00:00.000Z`).getTime();
  const candidates = await prisma.busJourney.findMany({
    where: {
      userId: ctx.userId,
      depStationName: { equals: key.dep, mode: "insensitive" },
      arrStationName: { equals: key.arr, mode: "insensitive" },
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

/** The merged columns; a moved terminal drops the frozen road line, which no longer joins them. */
function derivedColumns(
  stored: BusJourney | null,
  input: UpdateBusJourneyInput
): Prisma.BusJourneyUncheckedUpdateInput {
  const state = mergeBusJourney(stored, input);
  const moved = input.departureStation !== undefined || input.arrivalStation !== undefined;
  if (!stored || !moved) return state;
  return { ...state, geometry: Prisma.DbNull, geometrySource: "straight" };
}

async function writeRide(
  ctx: Ctx,
  targetId: string | null,
  data: Record<string, unknown>,
  companionNames: string[] | undefined
): Promise<string> {
  const companions =
    companionNames === undefined ? undefined : await resolveCompanions(ctx.userId, companionNames);
  return prisma.$transaction(async (tx) => {
    const payload = {
      ...data,
      ...(companions && { companions: companions.map((c) => c.displayName) }),
    };
    const id = targetId
      ? (await tx.busJourney.update({ where: { id: targetId }, data: payload })).id
      : (
          await tx.busJourney.create({
            data: { ...payload, userId: ctx.userId } as Prisma.BusJourneyUncheckedCreateInput,
          })
        ).id;
    if (companions) {
      await tx.busJourneyCompanion.deleteMany({ where: { busJourneyId: id } });
      if (companions.length > 0) {
        await tx.busJourneyCompanion.createMany({
          data: linkRowsFor(companions.map((c) => c.id)).map((row) => ({
            ...row,
            busJourneyId: id,
          })),
          skipDuplicates: true,
        });
      }
    }
    return id;
  });
}

export async function importBus(sheet: IncomingSheet, ctx: Ctx): Promise<SheetOutcome> {
  const out: RowOutcome[] = [];
  const seen = new Set<string>();
  const baseCurrency = await getBaseCurrency(ctx.userId);
  const touchedTrips = new Set<string>();

  for (const [index, raw] of sheet.rows.entries()) {
    const rowNo = sheetRowNumber(sheet, index);
    const fileId = cell.text(raw.id);
    const label =
      [cell.text(raw.depStationName), cell.text(raw.arrStationName)].filter(Boolean).join(" → ") ||
      `#${rowNo}`;
    const refuse = (message: string): void => {
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
    const dep = terminalCells(raw, "dep");
    const arr = terminalCells(raw, "arr");
    if (dep === "invalid" || arr === "invalid") {
      refuse("invalid_coordinates");
      continue;
    }
    const trip = await resolveTrip(raw.tripId, ctx.userId);
    const notes = trip.note ? [trip.note] : undefined;

    // Scoped by userId: a foreign id misses and the row is new to this account.
    const owned = fileId
      ? await prisma.busJourney.findFirst({ where: { id: fileId, userId: ctx.userId } })
      : null;
    const target =
      owned ??
      (await matchRide(ctx, {
        dep: dep.name,
        arr: arr.name,
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

    const input = derivedInput(raw, target, { dep, arr }, dropped);
    if (input === "needs_coordinates") {
      refuse("bus_needs_coordinates");
      continue;
    }
    if (!target && (!input.departureStation || !input.arrivalStation || !input.departureLocal)) {
      refuse("bus_needs_route");
      continue;
    }

    let derived: Prisma.BusJourneyUncheckedUpdateInput;
    try {
      derived = Object.keys(input).length > 0 || !target ? derivedColumns(target, input) : {};
    } catch (err) {
      // An arrival before the departure, or an unreadable clock.
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
      id = await writeRide(
        ctx,
        target?.id ?? null,
        data,
        companionsChanged ? companionNames : undefined
      );
      for (const t of [target?.tripId, data.tripId]) if (typeof t === "string") touchedTrips.add(t);
      seen.add(id);
      ctx.claimed.add(id);
      ctx.wrote = true;
    }
    out.push({ row: rowNo, action: target ? "update" : "create", id, label, message, ...extra });
  }

  for (const tripId of touchedTrips) await recomputeTripStatus(tripId);
  const deleted = await pruneMissing("busJourney", seen, ctx);
  return summarise(sheet.key, out, deleted);
}
