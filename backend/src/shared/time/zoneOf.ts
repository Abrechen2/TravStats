// The FULL dataset. geo-tz's default is "now", which folds every zone that
// keeps today's clock into one name: Bangkok came back as Asia/Jakarta
// (CAMP-03).
//
// Imported by its FILE subpath, `geo-tz/dist/find-all`, not by the `./all`
// export. `moduleResolution: node` cannot see an exports subpath, so the
// types were once borrowed through a tsconfig `paths` entry that pointed at
// the `.d.ts`. tsc ignores `paths` when it emits, so the compiled server was
// fine — but tsx HONOURS `paths` at runtime, loaded the empty `.d.ts`, and
// every lookup under `npm run dev` threw "find is not a function". A
// try/catch turned that into "no zone", and rail journeys and hotel
// countdowns quietly read local wall clocks as UTC (acceptance 2026-09-26).
// The file subpath is both a real file for tsc and an entry in geo-tz's
// `exports`, so tsc, tsx, jest and plain node all load the same module.
import * as geoTz from "geo-tz/dist/find-all";
import logger from "../../utils/logger";
import { TzUnresolvedError, ZoneLookupUnavailableError } from "./errors";
import { isValidZone } from "./zonedParts";

/**
 * "Which zone is this place in" — the one resolver (ADR 0002, D2).
 *
 * Every zone derived from a place goes through here, and it never falls back
 * to the server's, the browser's, the device's or a profile's zone: a wall
 * clock read in the wrong zone is a wrong number on screen that nothing
 * flags. `timezoneOfLodging` (utils/stayInstant.ts) and the airport
 * `deriveTimezone` are thin names for it that later phases retire.
 *
 * Two failures, kept apart (see `errors.ts`): the place has no zone
 * (`TzUnresolvedError`, 422 `TZ_UNRESOLVED`), and the lookup cannot run
 * (`ZoneLookupUnavailableError`, 503 `TIMEZONE_LOOKUP_UNAVAILABLE`).
 */

/** A place as the resolver reads it. */
export interface ZonePlace {
  /** The zone a catalogue row (airport, port, rail station) already carries. */
  catalogueZone?: string | null;
  lat?: number | null;
  lon?: number | null;
}

function onTheGlobe(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** geo-tz's answer for a valid coordinate; throws `ZoneLookupUnavailableError` when it cannot run. */
function zoneFromCoordinates(lat: number, lon: number): string | null {
  try {
    if (typeof geoTz.find !== "function") {
      throw new Error("geo-tz find-all did not load (find is not a function)");
    }
    // Most specific zone first; an empty array is a real answer.
    const [zone] = geoTz.find(lat, lon);
    return zone ?? null;
  } catch (cause) {
    logger.error({
      operation: "timezone_lookup_failed",
      message: "Time zone lookup failed for a valid coordinate",
      error: cause,
    });
    logger.debug({ operation: "timezone_lookup_failed", context: { lat, lon } });
    throw new ZoneLookupUnavailableError(cause);
  }
}

export type ZoneSource = "catalogue" | "coordinates";

export interface ResolvedZone {
  zone: string;
  source: ZoneSource;
}

/**
 * The IANA zone of a place: the catalogue's zone first (when it names one
 * this runtime knows), its coordinates through geo-tz second.
 *
 * Throws `TzUnresolvedError` when the place has none — no usable catalogue
 * zone and no coordinates, a coordinate off the globe, or a point geo-tz
 * places in no zone — and `ZoneLookupUnavailableError` when the lookup
 * cannot run. The caller that can live without a zone stores the value with
 * precision `unknown` (D2); none may substitute UTC.
 */
export function resolveZone(place: ZonePlace): ResolvedZone {
  const { catalogueZone, lat, lon } = place;
  if (isValidZone(catalogueZone)) return { zone: catalogueZone, source: "catalogue" };
  if (typeof lat !== "number" || typeof lon !== "number") {
    throw new TzUnresolvedError("no catalogue zone and no coordinates");
  }
  if (!onTheGlobe(lat, lon)) throw new TzUnresolvedError("coordinates off the globe");
  const zone = zoneFromCoordinates(lat, lon);
  if (!zone) throw new TzUnresolvedError("no zone at these coordinates");
  return { zone, source: "coordinates" };
}

/**
 * `resolveZone` for a caller that abstains: null when the place HAS no zone.
 * A lookup that cannot run still throws (`TIMEZONE_LOOKUP_UNAVAILABLE`) — a
 * broken lookup is never "no zone", which is how rail journeys and hotel
 * countdowns once read local wall clocks as UTC.
 */
export function zoneOf(place: ZonePlace): string | null {
  try {
    return resolveZone(place).zone;
  } catch (error) {
    if (error instanceof TzUnresolvedError) return null;
    throw error;
  }
}

/** A coordinate whose zone is known and will not move: Berlin. */
const SELF_CHECK = { lat: 52.52, lon: 13.405, zone: "Europe/Berlin" } as const;

export type ZoneSelfCheck = { ok: true } | { ok: false; reason: string };

let lastSelfCheck: ZoneSelfCheck | null = null;

/**
 * Asks the resolver's coordinate path for a point whose answer is fixed. Run
 * at boot; the result is kept for `/health`, so a server whose zone lookup is
 * broken says so instead of reading every local time as UTC.
 */
export function runZoneSelfCheck(): ZoneSelfCheck {
  let result: ZoneSelfCheck;
  try {
    const zone = zoneOf({ lat: SELF_CHECK.lat, lon: SELF_CHECK.lon });
    result =
      zone === SELF_CHECK.zone
        ? { ok: true }
        : { ok: false, reason: `expected ${SELF_CHECK.zone}, got ${zone ?? "null"}` };
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!result.ok) {
    logger.error({
      operation: "timezone_self_check_failed",
      message: "Time zone lookup self-check failed — local times cannot be interpreted",
      context: { reason: result.reason },
    });
  }
  lastSelfCheck = result;
  return result;
}

/** The last boot self-check, or null before it ran. */
export function zoneSelfCheckResult(): ZoneSelfCheck | null {
  return lastSelfCheck;
}
