import { prisma } from "../../db";
import { AVAILABLE_DOMAINS, type DomainKey } from "../../shared/domains";
import { countableFlightWhere } from "../../shared/flightCounting";
import { mostVisitedIata } from "../../shared/photoScan";
import { getHomeAirportAt, type HomeAirportEntry } from "../../utils/homeAirport";
import { getCachedAirports } from "../airportCache";
import { getInstanceSettings } from "../instanceSettingsService";
import { loadHomeAirportHistory } from "../stats/homeAirportHistory";
import { ROW_CAP } from "./loadTransport";
import { storedDay } from "./time";
import type { Coordinate, HomeAt, HomeSource, TripContext } from "./types";

/**
 * What the engine needs besides the entries: which domains it may read, where
 * home was, and which trips exist.
 */

/**
 * Domains that sit behind the instance's beta switch, and the key that gates
 * each (`frontend/src/config/betaFeatures.ts`). The engine applies the gate on
 * the server because a proposal is SHOWN: a rail ride inside a trip suggestion
 * would put a domain on screen that the reader's instance hides everywhere
 * else. Tours share the roadtrip key, as they do in the UI (`useToursVisible`).
 */
const BETA_GATED: Partial<Record<DomainKey, string>> = {
  rail: "railDomain",
  roadtrip: "roadtrips",
};

/**
 * What the engine may read for this user: their enabled domains that the
 * instance also shows, in registry order — and their profile zone, which
 * decides "today" (ADR 0002, D4).
 */
export async function readUserScope(
  userId: string
): Promise<{ domains: DomainKey[]; profileZone: string | null }> {
  const [settings, instance] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId },
      select: { enabledDomains: true, data: true },
    }),
    getInstanceSettings(),
  ]);
  const enabled = new Set(settings?.enabledDomains ?? ["flight"]);
  const display = (settings?.data as { display?: { timezone?: unknown } } | null)?.display;
  return {
    domains: AVAILABLE_DOMAINS.filter(
      (key) => enabled.has(key) && (BETA_GATED[key] === undefined || instance.betaFeaturesEnabled)
    ),
    profileZone: typeof display?.timezone === "string" ? display.timezone : null,
  };
}

/**
 * Home by date, from the recorded home-airport history.
 *
 * Days BEFORE the first recorded home take the first home: the history starts
 * on the day the user first set it, and treating every earlier day as "no home"
 * would silence all the travel that happened before the setting existed. A gap
 * the history itself leaves stays unknown.
 */
export function homeFromHistory(
  history: readonly HomeAirportEntry[],
  coords: ReadonlyMap<string, Coordinate>
): HomeAt {
  if (history.length === 0) return () => null;
  const first = history[0];
  return (day) => {
    const iata = getHomeAirportAt([...history], day) ?? (day < first.fromDate ? first.iata : null);
    return iata ? (coords.get(iata) ?? null) : null;
  };
}

export async function resolveHome(userId: string): Promise<{ homeAt: HomeAt; source: HomeSource }> {
  const history = await loadHomeAirportHistory(userId);
  if (history.length > 0) {
    const airports = await getCachedAirports([...new Set(history.map((h) => h.iata))]);
    const coords = new Map<string, Coordinate>();
    for (const [code, a] of airports) coords.set(code, { lat: a.lat, lon: a.lon });
    return { homeAt: homeFromHistory(history, coords), source: "history" };
  }
  // No home set: the most-visited airport of the FLOWN flights stands in — the
  // photo scan's rule (`shared/photoScan.ts`). A booked connection says nothing
  // about where somebody lives.
  const flown = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: { depIata: true, arrIata: true },
    take: ROW_CAP,
  });
  const iata = mostVisitedIata(flown);
  if (iata === null) return { homeAt: () => null, source: "missing" };
  const airport = (await getCachedAirports([iata])).get(iata);
  if (!airport) return { homeAt: () => null, source: "missing" };
  const at = { lat: airport.lat, lon: airport.lon };
  return { homeAt: () => at, source: "estimated" };
}

export async function loadTrips(userId: string): Promise<TripContext[]> {
  const rows = await prisma.trip.findMany({
    where: { userId },
    select: { id: true, name: true, startDate: true, endDate: true },
    orderBy: { id: "asc" },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    startDay: t.startDate ? storedDay(t.startDate) : null,
    endDay: t.endDate ? storedDay(t.endDate) : null,
  }));
}
