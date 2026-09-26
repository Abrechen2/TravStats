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
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";

/**
 * "Which zone is this place in" — the one resolver (ADR 0002, D2).
 *
 * Phase 1 of the time model: every zone derived from a place goes through
 * `zoneOf`, which never falls back to the server's, the browser's or a
 * profile's zone. `timezoneOfLodging` (utils/stayInstant.ts) and the airport
 * `deriveTimezone` are thin names for it that later phases retire.
 */

/**
 * The resolver could not run — not "this point has no zone". Thrown so that
 * no caller can mistake a broken lookup for open ocean and read a wall clock
 * as UTC. A 503, because the request was fine and the server is not.
 */
export class ZoneUnresolvedError extends AppError {
  constructor(cause: unknown) {
    super(
      `Time zone could not be resolved: ${cause instanceof Error ? cause.message : String(cause)}`,
      503,
      "TZ_UNRESOLVED"
    );
    this.name = "ZoneUnresolvedError";
  }
}

/** A place as the resolver reads it. */
export interface ZonePlace {
  /** The zone a catalogue row (airport, port, rail station) already carries. */
  catalogueZone?: string | null;
  lat?: number | null;
  lon?: number | null;
}

function isKnownZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    // Intl throws RangeError for a zone it does not know — the answer here,
    // not a failure: the catalogue value is unusable, so coordinates decide.
    return false;
  }
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

/** geo-tz's answer for a valid coordinate; throws `ZoneUnresolvedError` when it cannot run. */
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
    throw new ZoneUnresolvedError(cause);
  }
}

/**
 * The IANA zone of a place: the catalogue's zone first (when it names one
 * Intl knows), its coordinates through geo-tz second.
 *
 * Null ONLY for an answer: no usable catalogue zone and no coordinates, or a
 * coordinate off the globe. A lookup that cannot run logs at error level and
 * throws `ZoneUnresolvedError` (`TZ_UNRESOLVED`) — a wall clock read as UTC
 * is a wrong number on screen, which is worse than a refused request.
 */
export function zoneOf(place: ZonePlace): string | null {
  const { catalogueZone, lat, lon } = place;
  if (catalogueZone && isKnownZone(catalogueZone)) return catalogueZone;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!onTheGlobe(lat, lon)) return null;
  return zoneFromCoordinates(lat, lon);
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
