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
import { AppError } from "../middleware/errorHandler";
import logger from "./logger";

/**
 * The zone lookup itself is broken — not "this point has no zone". Thrown so
 * that no caller can mistake a missing library for open ocean and read a
 * wall clock as UTC. A 503 with a code, because the request was fine and the
 * server is not.
 */
export class TimezoneLookupError extends AppError {
  constructor(cause: unknown) {
    super(
      `Time zone lookup unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      503,
      "TIMEZONE_LOOKUP_UNAVAILABLE"
    );
    this.name = "TimezoneLookupError";
  }
}

function inRange(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * The IANA zone a coordinate pair sits in.
 *
 * Null ONLY for an answer: no coordinates, a coordinate outside the globe,
 * or a point the dataset covers with no zone. A lookup that cannot run throws
 * `TimezoneLookupError` and logs at error level — a wall clock read as UTC is
 * a wrong number on screen, which is worse than a failed request.
 */
export function zoneAt(lat?: number | null, lon?: number | null): string | null {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (!inRange(lat, lon)) return null;
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
      context: { lat, lon },
      error: cause,
    });
    throw new TimezoneLookupError(cause);
  }
}

/** A coordinate whose zone is known and will not move: Berlin. */
const SELF_CHECK = { lat: 52.52, lon: 13.405, zone: "Europe/Berlin" } as const;

export type TimezoneSelfCheck = { ok: true } | { ok: false; reason: string };

let lastSelfCheck: TimezoneSelfCheck | null = null;

/**
 * Asks the lookup for a coordinate whose answer is fixed. Run at boot; the
 * result is kept for the health endpoint, so a server whose zone lookup is
 * broken says so instead of reading every local time as UTC.
 */
export function runTimezoneSelfCheck(): TimezoneSelfCheck {
  let result: TimezoneSelfCheck;
  try {
    const zone = zoneAt(SELF_CHECK.lat, SELF_CHECK.lon);
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
export function timezoneSelfCheckResult(): TimezoneSelfCheck | null {
  return lastSelfCheck;
}
