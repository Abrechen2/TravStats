import { prisma } from "../../db";
import { LocalTimeNonexistentError } from "../../shared/time/errors";
import { toInstant, type LocalTimeOrigin } from "../../shared/time/instant";
import { zoneOf } from "../../shared/time/zoneOf";
import { dbDayOrNull } from "./dayColumns";

/**
 * The new time columns of a lodging stay (ADR 0002 phase 2 dual-write),
 * derived from the legacy ones the stay write paths already compute: the
 * check-in/-out days as `DATE`s, the instants they begin and end — the day
 * plus its "HH:mm" in the HOTEL's zone — and that zone.
 *
 * Without coordinates the hotel has no zone: the days are still known, the
 * instants are not, and they stay null rather than being read as UTC (D2).
 */

export interface StayLegacyTimes {
  checkIn: Date | null;
  checkOut: Date | null;
  checkInTime: string | null;
  checkOutTime: string | null;
}

export interface StayTimeColumns {
  checkInDate: Date | null;
  checkOutDate: Date | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  stayZone: string | null;
}

/** The hotel's zone, or null when it has no position. */
export async function zoneOfLodging(lodgingId: string): Promise<string | null> {
  const lodging = await prisma.lodging.findUnique({
    where: { id: lodgingId },
    select: { lat: true, lon: true },
  });
  return lodging ? zoneOf({ lat: lodging.lat, lon: lodging.lon }) : null;
}

function instantAt(
  day: Date | null,
  time: string | null,
  zone: string | null,
  origin: LocalTimeOrigin,
  field: string
): Date | null {
  if (!day || !time || !zone) return null;
  const local = `${day.toISOString().slice(0, 10)}T${time}`;
  try {
    return toInstant(local, zone, { origin }).utc;
  } catch (error) {
    if (error instanceof LocalTimeNonexistentError) {
      throw new LocalTimeNonexistentError(local, zone, field);
    }
    throw error;
  }
}

/**
 * The new columns for the stay's final legacy values. `origin: "typed"` (the
 * stay editor) refuses a check-in time the hotel's clock skipped; an import
 * is a machine reading and is never refused for it.
 */
export function stayTimeColumns(
  legacy: StayLegacyTimes,
  zone: string | null,
  origin: LocalTimeOrigin = "typed"
): StayTimeColumns {
  return {
    checkInDate: dbDayOrNull(legacy.checkIn),
    checkOutDate: dbDayOrNull(legacy.checkOut),
    checkInAt: instantAt(legacy.checkIn, legacy.checkInTime, zone, origin, "checkInTime"),
    checkOutAt: instantAt(legacy.checkOut, legacy.checkOutTime, zone, origin, "checkOutTime"),
    stayZone: zone,
  };
}

/** Parses a legacy day value as the route layer hands it on (ISO string or Date). */
export function legacyDay(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}
