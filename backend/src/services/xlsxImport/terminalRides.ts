/**
 * Rides between two catalogue-less terminals from a spreadsheet — the bus
 * sheet (forgejo#180) and the ferry sheet, which carry the same columns for
 * their two ends and differ only in their own plain columns. The round trip of
 * the sheets the export writes (`frontend/src/lib/xlsx/busSheet.ts`,
 * `ferrySheet.ts`), on every sheet's rules (`importSheets.ts`, `context.ts`):
 * a row whose id names one of the caller's rides updates it; no id, an unknown
 * id or another account's id means the ride is new here — recognised by its
 * natural key (both terminal names + the departure day on the departure
 * terminal's clock) when it already is, created otherwise. A row that changes
 * nothing is not written. An unknown status is left empty and reported, never
 * a reason to refuse the row.
 *
 * Every write goes through the domain's write rules (`terminalRideWrite.ts`):
 * the times in the sheet are the TERMINAL's wall clock, as the export writes
 * them; the server finds each terminal's zone from its coordinates and stores
 * the real instant; status and distance are derived, as for a ride typed into
 * the form. A distance travels back only when the sheet says it came from the
 * ticket (`user`).
 */

import { AppError } from "../../middleware/errorHandler";
import type { TerminalRideInput } from "../rides/terminalRideWrite";
import { instantToWallClock } from "../rail/railJourneyWrite";
import { recomputeTripStatus } from "../tripStatusService";
import { fxColumnsFor, getBaseCurrency } from "../fx/snapshot";
import * as cell from "./cells";
import { MATCHED, type Ctx, errorRow, keepDespiteError } from "./context";
import { pruneMissing, type PrunableModel } from "./prune";
import { resolveTrip } from "./references";
import {
  sheetRowNumber,
  summarise,
  type DroppedValue,
  type IncomingSheet,
  type RowOutcome,
  type SheetOutcome,
} from "./types";
import { changedOnly, droppedOrNone, enumCell, priceRefusal } from "./values";

const DAY_MS = 86_400_000;
type End = "dep" | "arr";

/** The stored columns these rules compare a row against. */
export interface TerminalRideRow {
  id: string;
  tripId: string | null;
  depStationName: string;
  depLat: number;
  depLon: number;
  depTimezone: string | null;
  arrStationName: string;
  arrLat: number;
  arrLon: number;
  arrTimezone: string | null;
  departureTime: Date;
  arrivalTime: Date | null;
  status: string;
  distanceKm: number | null;
  distanceSource: string | null;
  price: number | null;
  currency: string | null;
}

/** The natural-key query a domain answers with its own delegate. */
export interface NaturalKeyWhere {
  userId: string;
  depStationName: { equals: string; mode: "insensitive" };
  arrStationName: { equals: string; mode: "insensitive" };
  departureTime: { gte: Date; lt: Date };
  id: { notIn: string[] };
}

/** What a domain hands the shared importer. */
export interface TerminalRideSheet<Row extends TerminalRideRow> {
  prune: PrunableModel;
  /** Statuses a cell may name (`cancelled` is the only one a person sets). */
  statuses: readonly string[];
  codes: { needsCoordinates: string; needsRoute: string };
  /** The domain's plain columns — no derivation, written as the sheet says. */
  plainFields(
    raw: Record<string, string>,
    dropped: DroppedValue[]
  ): Record<string, unknown> & { price?: number; currency?: string; delayMinutes?: number };
  findOwned(id: string, userId: string): Promise<Row | null>;
  findByNaturalKey(where: NaturalKeyWhere): Promise<Row[]>;
  /** The merged derived columns for the input; throws `AppError` for an impossible clock. */
  derivedColumns(stored: Row | null, input: TerminalRideInput): Record<string, unknown>;
  /** Writes the row and its companion links; returns its id. */
  write(
    ctx: Ctx,
    targetId: string | null,
    data: Record<string, unknown>,
    companionNames: string[] | undefined
  ): Promise<string>;
  /**
   * Work after the row is committed (a ferry's sea route). Returns a note code
   * for the row when that work failed, so the preview says so; never throws.
   */
  afterWrite?(ctx: Ctx, id: string): Promise<string | null>;
}

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

/** What the row asks of the derived columns; only what differs from `stored` (a new ride: all). */
function derivedInput(
  raw: Record<string, string>,
  stored: TerminalRideRow | null,
  cells: Record<End, TerminalCells>,
  statuses: readonly string[],
  dropped: DroppedValue[]
): TerminalRideInput | "needs_coordinates" {
  const input: TerminalRideInput = {};
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
    // A terminal has no catalogue: without coordinates it cannot be placed.
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
  const status = enumCell(raw.status, statuses, "status", dropped);
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
async function matchRide<Row extends TerminalRideRow>(
  spec: TerminalRideSheet<Row>,
  ctx: Ctx,
  key: { dep?: string; arr?: string; departureDay?: string }
): Promise<Row | null> {
  if (!key.dep || !key.arr || !key.departureDay) return null;
  const day = new Date(`${key.departureDay}T00:00:00.000Z`).getTime();
  const candidates = await spec.findByNaturalKey({
    userId: ctx.userId,
    depStationName: { equals: key.dep, mode: "insensitive" },
    arrStationName: { equals: key.arr, mode: "insensitive" },
    departureTime: { gte: new Date(day - DAY_MS), lt: new Date(day + 2 * DAY_MS) },
    id: { notIn: [...ctx.claimed] },
  });
  return (
    candidates.find(
      (r) => instantToWallClock(r.departureTime, r.depTimezone).slice(0, 10) === key.departureDay
    ) ?? null
  );
}

export async function importTerminalRides<Row extends TerminalRideRow>(
  sheet: IncomingSheet,
  ctx: Ctx,
  spec: TerminalRideSheet<Row>
): Promise<SheetOutcome> {
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
    const fields = spec.plainFields(raw, dropped);
    if (Number.isNaN(fields.price) || Number.isNaN(fields.delayMinutes)) {
      refuse("invalid_number");
      continue;
    }
    const moneyProblem = priceRefusal(fields);
    if (moneyProblem) {
      refuse(moneyProblem);
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
    const owned = fileId ? await spec.findOwned(fileId, ctx.userId) : null;
    const target =
      owned ??
      (await matchRide(spec, ctx, {
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

    const input = derivedInput(raw, target, { dep, arr }, spec.statuses, dropped);
    if (input === "needs_coordinates") {
      refuse(spec.codes.needsCoordinates);
      continue;
    }
    if (!target && (!input.departureStation || !input.arrivalStation || !input.departureLocal)) {
      refuse(spec.codes.needsRoute);
      continue;
    }

    let derived: Record<string, unknown>;
    try {
      derived = Object.keys(input).length > 0 || !target ? spec.derivedColumns(target, input) : {};
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
    const stored = target as unknown as Record<string, unknown> | null;
    const data: Record<string, unknown> = stored ? changedOnly(incoming, stored) : incoming;
    const companionsChanged =
      companionNames !== undefined &&
      (!stored || Object.keys(changedOnly({ companions: companionNames }, stored)).length > 0);
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
    let afterNote: string | null = null;
    if (!ctx.dryRun) {
      id = await spec.write(
        ctx,
        target?.id ?? null,
        data,
        companionsChanged ? companionNames : undefined
      );
      afterNote = spec.afterWrite ? await spec.afterWrite(ctx, id) : null;
      for (const t of [target?.tripId, data.tripId]) if (typeof t === "string") touchedTrips.add(t);
      seen.add(id);
      ctx.claimed.add(id);
      ctx.wrote = true;
    }
    out.push({
      row: rowNo,
      action: target ? "update" : "create",
      id,
      label,
      message,
      ...extra,
      ...(afterNote && { notes: [...(notes ?? []), afterNote] }),
    });
  }

  for (const tripId of touchedTrips) await recomputeTripStatus(tripId);
  const deleted = await pruneMissing(spec.prune, seen, ctx);
  return summarise(sheet.key, out, deleted);
}
