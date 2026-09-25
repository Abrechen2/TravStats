import { prisma } from "../db";
import logger from "../utils/logger";
import { backfillAirportTimezones, deriveTimezone } from "./airportLookup";
import { clearAirportCache } from "./airportCache";

/** The geo-tz dataset every airport zone is derived from since 2026-09-24. */
export const AIRPORT_TIMEZONE_DATASET = "all";

/** "+07:00"-style offset of a zone at one instant, or null for a zone Intl does not know. */
function offsetAt(zone: string, at: Date): string | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether two zones keep the same clock today, winter and summer. That is
 * exactly what geo-tz's "now" dataset folded together, so a stored zone that
 * differs from the full answer AND passes this test is a fold, not a choice.
 * A zone somebody set on purpose to a different clock fails it and is kept.
 */
export function sameClockToday(a: string, b: string, now: Date = new Date()): boolean {
  const year = now.getUTCFullYear();
  return [new Date(Date.UTC(year, 0, 15)), new Date(Date.UTC(year, 6, 15))].every((at) => {
    const offset = offsetAt(a, at);
    return offset !== null && offset === offsetAt(b, at);
  });
}

/**
 * Re-derives the catalogue's airport zones once, after the switch from
 * geo-tz's default "now" dataset to "all" (CAMP-03).
 *
 * "now" folds every zone that keeps today's clock into one name, so the
 * backfill wrote Asia/Jakarta for Bangkok, Europe/London for Dublin and
 * Pacific/Honolulu for Tahiti — 526 airports on a test catalogue. Today's
 * offsets are right; the names are wrong, and so is any past date on which
 * the two zones kept different clocks, which a logbook of old flights reads.
 *
 * Only a stored zone that the full dataset names differently AND that keeps
 * the same clock today is replaced; every other stored zone is somebody's
 * choice and stays. Runs once per instance: `admin_settings.
 * airport_timezone_dataset` records it, because a full pass loads geo-tz's
 * whole dataset, which a small host should not pay for on every boot.
 */
/**
 * The zone a stored one should become, or null to keep it: only a zone the
 * full dataset names differently AND that keeps the same clock. Pure, so the
 * rule is tested without the shared settings row.
 */
export function refoldedZone(stored: string, derived: string | null): string | null {
  if (derived === null || derived === stored || !sameClockToday(stored, derived)) return null;
  return derived;
}

export async function repairFoldedAirportTimezones(
  options: { force?: boolean } = {}
): Promise<number> {
  const settings = await prisma.adminSettings.findFirst({
    orderBy: { id: "asc" },
    select: { id: true, airportTimezoneDataset: true },
  });
  const done = !settings || settings.airportTimezoneDataset === AIRPORT_TIMEZONE_DATASET;
  if (done && !options.force) return 0;

  const airports = await prisma.airport.findMany({
    where: { timezone: { not: null } },
    select: { id: true, lat: true, lon: true, timezone: true },
  });

  let repaired = 0;
  for (const airport of airports) {
    const stored = airport.timezone;
    if (stored === null) continue;
    const next = refoldedZone(stored, deriveTimezone(airport.lat, airport.lon));
    if (next === null) continue;
    await prisma.airport.update({ where: { id: airport.id }, data: { timezone: next } });
    repaired++;
  }

  if (settings) {
    await prisma.adminSettings.update({
      where: { id: settings.id },
      data: { airportTimezoneDataset: AIRPORT_TIMEZONE_DATASET },
    });
  }
  logger.info({
    operation: "airport_timezone_repair",
    message: `Re-derived ${repaired} airport time zones from the full geo-tz dataset`,
    context: { checked: airports.length, repaired },
  });
  return repaired;
}

/**
 * The server-start step for airport zones: fill the ones that are missing,
 * then the one-time repair above. Each half logs and swallows its own failure
 * — a catalogue without zones degrades local times, it must not stop a boot.
 */
export async function refreshAirportTimezonesOnStartup(): Promise<void> {
  let changed = 0;
  try {
    changed += await backfillAirportTimezones();
  } catch (error) {
    logger.warn({
      operation: "server_start_timezone_backfill_error",
      message: "Failed to backfill airport timezones",
      error,
    });
  }
  try {
    changed += await repairFoldedAirportTimezones();
  } catch (error) {
    logger.warn({
      operation: "server_start_timezone_repair_error",
      message: "Failed to repair folded airport timezones",
      error,
    });
  }
  if (changed > 0) clearAirportCache();
}
