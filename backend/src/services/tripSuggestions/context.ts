import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import { countableFlightWhere } from "../../shared/flightCounting";
import { mostVisitedIata } from "../../shared/photoScan";
import { profileZoneFromSettings } from "../../shared/time/profileZone";
import { residenceAt, type HomePeriod } from "../../utils/homeAirport";
import { getCachedAirports } from "../airportCache";
import { visibleDomainKeys } from "../domainVisibility";
import { getInstanceSettings } from "../instanceSettingsService";
import { loadHomePeriods } from "../home/homeStore";
import { ROW_CAP } from "./loadTransport";
import { storedDay } from "./time";
import type { HomeAt, HomeSource, TripContext } from "./types";

/**
 * What the engine needs besides the entries: which domains it may read, where
 * home was, and which trips exist.
 */

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
  const profile = profileZoneFromSettings(settings?.data);
  return {
    // The instance's beta gate applies on the server because a proposal is
    // SHOWN: a ride inside a trip suggestion would put a domain on screen that
    // the reader's instance hides everywhere else.
    domains: visibleDomainKeys(settings?.enabledDomains, instance.betaFeaturesEnabled),
    profileZone: profile.source === "profile" ? profile.zone : null,
  };
}

/**
 * Home by date: the RESIDENCE of the period covering the day — "away" is a
 * distance question, and measuring it from an airport made DUS "away" for
 * somebody living in Köln (owner decision 2026-09-27). An unconfirmed period
 * migrated from the old shape sits at its airport, so its answers are the
 * ones the airport always gave.
 *
 * Days BEFORE the first recorded home take the first home: the history starts
 * on the day the user first set it, and treating every earlier day as "no home"
 * would silence all the travel that happened before the setting existed. A gap
 * the history itself leaves stays unknown.
 */
export function homeFromPeriods(periods: readonly HomePeriod[]): HomeAt {
  if (periods.length === 0) return () => null;
  const first = periods[0];
  return (day) => residenceAt(periods, day < first.fromDate ? first.fromDate : day);
}

export async function resolveHome(userId: string): Promise<{ homeAt: HomeAt; source: HomeSource }> {
  const periods = await loadHomePeriods(userId);
  if (periods.length > 0) return { homeAt: homeFromPeriods(periods), source: "history" };
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
