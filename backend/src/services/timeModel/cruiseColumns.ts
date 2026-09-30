import { prisma } from "../../db";
import { toDbDate } from "../../shared/time/localDate";
import {
  fakeUtcOf,
  instantOfFakeUtc,
  resolveTimeField,
  type ResolvedTime,
} from "../../shared/time/resolveInput";
import { TimeShapeRequiredError } from "../../shared/time/errors";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import type { TimePrecision } from "../../shared/time/wire";
import { zoneOf } from "../../shared/time/zoneOf";
import { dbDayOrNull } from "./dayColumns";

/**
 * Cruise and cruise-stop time columns (ADR 0002 phase 2 dual-write).
 *
 * A port call happens on the PORT's clock. `arrivalTime`/`departureTime` keep
 * their old meaning — that wall clock stored as if it were UTC — and the new
 * columns carry the real instants, the port's zone, the call's local day and
 * a precision. A sea day or an unresolved port has no zone: whatever time it
 * carries stays in the legacy column and the precision says `unknown`, never
 * a UTC guess (D2). Cruise start/end are local days at the departure and
 * arrival port.
 */

/** Zones of catalogue ports (catalogue zone first, then the coordinates). */
export async function portZones(
  ids: Array<number | null | undefined>
): Promise<Map<number, string | null>> {
  const wanted = [...new Set(ids.filter((id): id is number => typeof id === "number"))];
  if (wanted.length === 0) return new Map();
  const ports = await prisma.port.findMany({
    where: { id: { in: wanted } },
    select: { id: true, timezone: true, lat: true, lon: true },
  });
  return new Map(
    ports.map((p) => [p.id, zoneOf({ catalogueZone: p.timezone, lat: p.lat, lon: p.lon })])
  );
}

export interface CruiseDayColumns {
  startDay: Date | null;
  endDay: Date | null;
  startZone: string | null;
  endZone: string | null;
}

/** The day columns from the legacy anchors and the ports they belong to. */
export async function cruiseDayColumns(input: {
  startDate: Date | null;
  endDate: Date | null;
  departurePortId: number | null;
  arrivalPortId: number | null;
}): Promise<CruiseDayColumns> {
  const zones = await portZones([input.departurePortId, input.arrivalPortId]);
  return {
    startDay: dbDayOrNull(input.startDate),
    endDay: dbDayOrNull(input.endDate),
    startZone:
      input.startDate && input.departurePortId ? (zones.get(input.departurePortId) ?? null) : null,
    endZone: input.endDate && input.arrivalPortId ? (zones.get(input.arrivalPortId) ?? null) : null,
  };
}

export interface StopTimeColumns {
  date: Date | null;
  arrivalTime: Date | null;
  departureTime: Date | null;
  arrivalUtc: Date | null;
  departureUtc: Date | null;
  stopZone: string | null;
  stopDate: Date | null;
  timePrecision: TimePrecision | null;
}

/** One stop's time columns from LEGACY values (importers, seeds): fake UTC + the port's zone. */
export function stopColumnsFromLegacy(
  legacy: { date: Date | null; arrivalTime: Date | null; departureTime: Date | null },
  zone: string | null
): StopTimeColumns {
  const hasTime = legacy.arrivalTime !== null || legacy.departureTime !== null;
  const dayFrom = legacy.date ?? legacy.arrivalTime ?? legacy.departureTime;
  return {
    ...legacy,
    arrivalUtc: zone && legacy.arrivalTime ? instantOfFakeUtc(legacy.arrivalTime, zone) : null,
    departureUtc:
      zone && legacy.departureTime ? instantOfFakeUtc(legacy.departureTime, zone) : null,
    stopZone: zone,
    stopDate: dbDayOrNull(dayFrom),
    timePrecision: hasTime ? (zone ? "minute" : "unknown") : legacy.date ? "day" : null,
  };
}

export interface StopRequestContext {
  userId: string;
  viaToken: boolean;
}

interface StopTimeInput {
  portId?: number | null;
  date?: string | null;
  arrivalTime?: TimeFieldInput | null;
  departureTime?: TimeFieldInput | null;
}

interface OneTime {
  legacy: Date;
  utc: Date | null;
  local: string | null;
}

/**
 * A time at a stop with no zone (sea day, unresolved port): what can be kept
 * without guessing. A typed wall clock stays a wall clock in the legacy
 * column; an instant from a token stays the instant it is.
 */
function unzonedTime(input: TimeFieldInput, ctx: StopRequestContext, field: string): OneTime {
  if (input.kind === "instant") {
    if (input.bareZ && !ctx.viaToken) throw new TimeShapeRequiredError(field);
    return { legacy: input.utc, utc: input.utc, local: null };
  }
  if (input.kind === "wallClockString" && !ctx.viaToken) throw new TimeShapeRequiredError(field);
  if (input.kind === "date") throw new TimeShapeRequiredError(field);
  return { legacy: new Date(`${input.local}Z`), utc: null, local: input.local };
}

async function stopTime(
  input: TimeFieldInput | null | undefined,
  zone: string | null,
  ctx: StopRequestContext,
  field: string
): Promise<OneTime | null> {
  if (!input) return null;
  const namesItsZone = input.kind === "local" && (input.zone || input.placeRef);
  if (!zone && !namesItsZone) return unzonedTime(input, ctx, field);
  const resolved: ResolvedTime = await resolveTimeField(input, {
    field,
    placeZone: () => zone,
    userId: ctx.userId,
    legacyFakeUtc: true,
    viaToken: ctx.viaToken,
  });
  return { legacy: fakeUtcOf(resolved), utc: resolved.utc, local: resolved.local };
}

/**
 * The time columns of stops a client sent. Refuses what it must (a typed time
 * a port's clock skipped, a stale browser bundle's fake UTC) with the index
 * of the stop in `field`, so the editor can point at the row.
 */
export async function stopColumnsFromRequest(
  stops: StopTimeInput[],
  ctx: StopRequestContext
): Promise<StopTimeColumns[]> {
  const zones = await portZones(stops.map((s) => s.portId));
  const rows: StopTimeColumns[] = [];
  for (const [index, stop] of stops.entries()) {
    const zone = stop.portId ? (zones.get(stop.portId) ?? null) : null;
    const arrival = await stopTime(stop.arrivalTime, zone, ctx, `stops.${index}.arrivalTime`);
    const departure = await stopTime(stop.departureTime, zone, ctx, `stops.${index}.departureTime`);
    const date = stop.date ? new Date(stop.date) : null;
    const firstLocal = arrival?.local ?? departure?.local ?? null;
    const times = [arrival, departure].filter((t): t is OneTime => t !== null);
    rows.push({
      date,
      arrivalTime: arrival?.legacy ?? null,
      departureTime: departure?.legacy ?? null,
      arrivalUtc: arrival?.utc ?? null,
      departureUtc: departure?.utc ?? null,
      stopZone: zone,
      stopDate: date ? dbDayOrNull(date) : firstLocal ? toDbDate(firstLocal.slice(0, 10)) : null,
      timePrecision:
        times.length > 0
          ? times.every((t) => t.utc !== null)
            ? "minute"
            : "unknown"
          : date
            ? "day"
            : null,
    });
  }
  return rows;
}

/** A schema-parsed stop time as the LEGACY value an importer means by it (fake UTC). */
export function legacyDateOf(input: TimeFieldInput | null | undefined): Date | null {
  if (!input) return null;
  if (input.kind === "instant") return input.utc;
  if (input.kind === "date") return toDbDate(input.date);
  return new Date(`${input.local}Z`);
}

/**
 * Stop columns for an IMPORT (the spreadsheet round-trip): its time cells are
 * the legacy fake-UTC values an export wrote, so they are read as such and
 * converted with each port's zone.
 */
export async function stopColumnsForImport(stops: StopTimeInput[]): Promise<StopTimeColumns[]> {
  const zones = await portZones(stops.map((s) => s.portId));
  return stops.map((stop) =>
    stopColumnsFromLegacy(
      {
        date: stop.date ? new Date(stop.date) : null,
        arrivalTime: legacyDateOf(stop.arrivalTime),
        departureTime: legacyDateOf(stop.departureTime),
      },
      stop.portId ? (zones.get(stop.portId) ?? null) : null
    )
  );
}
