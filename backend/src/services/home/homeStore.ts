/**
 * Reading and writing a user's home periods (`utils/homeAirport.ts`).
 *
 * The ONE place that reads `UserSettings.data` for home. Every statistic, the
 * trip suggestions, trip detection, the prefills, the settings API and the
 * inbox question go through `loadHomePeriods`, so an account that still holds
 * only the old `homeAirportHistory` is migrated the same way everywhere — the
 * trip suggestions and the airport statistics cannot disagree about where an
 * unconfirmed user lives.
 */

import { prisma } from "../../db";
import { airportDisplayName } from "../../utils/airportDisplay";
import {
  legacyHistoryOf,
  normalizeHistory,
  periodsFromLegacy,
  readStoredPeriods,
  type AirportForHome,
  type HomePeriod,
} from "../../utils/homeAirport";
import { getCachedAirports } from "../airportCache";
import type { AirportData } from "../airportLookup";

/** The settings keys this module owns. */
export const HOME_PERIODS_KEY = "homePeriods";
export const LEGACY_HISTORY_KEY = "homeAirportHistory";

export function airportForHome(airport: AirportData | undefined | null): AirportForHome | null {
  if (!airport) return null;
  return { lat: airport.lat, lon: airport.lon, name: airportDisplayName(airport) };
}

/** Catalogue facts for the given codes, keyed by code — unknown codes are absent. */
export async function loadAirportsForHome(
  codes: readonly string[]
): Promise<Map<string, AirportForHome>> {
  const unique = [...new Set(codes.map((c) => c.toUpperCase()))];
  if (unique.length === 0) return new Map();
  const airports = await getCachedAirports(unique);
  const result = new Map<string, AirportForHome>();
  for (const [code, airport] of airports) {
    const home = airportForHome(airport);
    if (home) result.set(code.toUpperCase(), home);
  }
  return result;
}

function asObject(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/**
 * The periods held in a settings blob. The new key wins whenever it is present
 * — even empty, which is a user who removed every period; the old key is
 * migrated only when the new one was never written.
 */
export async function homePeriodsFromData(data: unknown): Promise<HomePeriod[]> {
  const blob = asObject(data);
  const stored = readStoredPeriods(blob[HOME_PERIODS_KEY]);
  if (stored !== null) return stored;
  const legacy = normalizeHistory(blob[LEGACY_HISTORY_KEY]);
  if (legacy.length === 0) return [];
  const airports = await loadAirportsForHome(legacy.map((e) => e.iata));
  return periodsFromLegacy(legacy, (code) => airports.get(code) ?? null);
}

/**
 * The two home keys as `GET /settings` publishes them: the periods, and the
 * legacy list DERIVED from them — never the stored mirror, so a blob written
 * by an older server (legacy key only) and one written by this one read alike.
 */
export async function homeSettingsView(
  data: unknown
): Promise<{ homePeriods: HomePeriod[]; homeAirportHistory: ReturnType<typeof legacyHistoryOf> }> {
  const homePeriods = await homePeriodsFromData(data);
  return { homePeriods, homeAirportHistory: legacyHistoryOf(homePeriods) };
}

export async function loadHomePeriods(userId: string): Promise<HomePeriod[]> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  return homePeriodsFromData(settings?.data);
}
