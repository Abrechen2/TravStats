// Adapter: Flight[] + country list -> DomainStats. Pure, sync.
import { groupAirlines } from "../../../shared/airlineNormalize";
import { airlineResolvers } from "../../airlineUtils";
import type { Flight } from "../../../types";
import { getFlightDuration } from "../../flightDuration";
import { localWallClockOf } from "../../../shared/localWallClock";
import type { DomainStats } from "./types";

export interface FlightAdapterInput {
  /** Already filtered to status === "flown" || "historical" by the caller. */
  flights: Flight[];
  /** ISO 3166-1 alpha-2 codes — comes from /stats/countries. */
  countries: string[];
  /** Same source, keyed by the year on the clock at the departure airport.
   *  Undefined when the backend predates the year index. */
  countriesByYear?: Record<number, string[]>;
}

const NUMBER_FMT = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export function adaptFlight(input: FlightAdapterInput): DomainStats {
  const { flights, countries, countriesByYear } = input;

  if (flights.length === 0) {
    return { domain: "flight", hasData: false };
  }

  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};
  // Same airline = same code (forgejo#81) — the rule the server's ranking uses.
  const { groups: airlineGroups } = groupAirlines(
    flights.map((f) => ({ ...f, count: 1 })),
    airlineResolvers
  );

  let totalDistanceKm = 0;
  let totalDurationHours = 0;

  for (const f of flights) {
    if (f.departureTime !== null) {
      const d = new Date(f.departureTime);
      if (!Number.isNaN(d.getTime())) {
        // On the clock at the departure airport, not the viewer's — otherwise
        // the same flight falls into different years for different readers,
        // and disagrees with the year index the backend sends (#266).
        const clock = localWallClockOf(d, f.depTimezone, f.depTimeSemantics);
        const year = clock.year;
        const ymKey = clock.date.slice(0, 7);
        const ymdKey = clock.date;
        yearlyEvents[year] = (yearlyEvents[year] ?? 0) + 1;
        weekdayEvents[clock.weekday] = (weekdayEvents[clock.weekday] ?? 0) + 1;
        // Active-day buckets are boolean per (domain, day); multiple
        // flights on the same day still equal 1 active day.
        if (!dailyActiveDays[ymdKey]) {
          dailyActiveDays[ymdKey] = 1;
          yearlyActiveDays[year] = (yearlyActiveDays[year] ?? 0) + 1;
          monthlyActiveDays[ymKey] = (monthlyActiveDays[ymKey] ?? 0) + 1;
        }
      }
    }

    totalDistanceKm += haversineKm(f.depLat, f.depLon, f.arrLat, f.arrLon);

    if (f.durationMinutes != null && f.durationMinutes > 0) {
      totalDurationHours += f.durationMinutes / 60;
    } else {
      const dur = getFlightDuration(f);
      if (dur && dur.minutes > 0) totalDurationHours += dur.minutes / 60;
    }
  }

  const topAirlines = airlineGroups.slice(0, 5).map((g) => ({ label: g.label, value: g.count }));

  return {
    domain: "flight",
    hasData: true,
    totalEvents: flights.length,
    totalDistanceKm,
    totalDurationHours,
    countries,
    countriesByYear,
    yearlyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: [
        { label: "Distanz", value: `${NUMBER_FMT.format(totalDistanceKm)} km` },
        { label: "Flugzeit", value: `${NUMBER_FMT.format(totalDurationHours)} h` },
        { label: "Airlines", value: airlineGroups.length },
      ],
      topItems: { title: "Top-Airlines", items: topAirlines },
      detailRoute: "/stats?tab=flight",
    },
  };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return 0;
  }
  const R = 6371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
