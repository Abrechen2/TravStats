/**
 * One domain's leaderboard totals, read through the SAME loaders the statistics pages use —
 * a leaderboard that counted differently from /stats would rank people on numbers they cannot
 * find on their own statistics page. Only scalar totals leave; the loaders' records do not.
 * The E2E transfer keeps its own copy (services/federation/domainMetrics.ts); see spec §6.
 */
import { prisma } from "../../db";
import type { DomainKey } from "../../shared/domains";
import type { MetricKey } from "../../shared/comparisonMetrics";
import { countableFerryWhere, ferryYear } from "../../shared/ferryCounting";
import {
  classifyPlace,
  classifyVisit,
  countCompletedVisits,
  visitCountsForYear,
} from "../../shared/placeCounting";
import { now } from "../../shared/time/clock";
import { buildWhere, computeSummary } from "../stats/summary";
import { loadCruiseStatsData } from "../stats/cruiseStatsData";
import { loadLodgingStatsData } from "../stats/lodgingStatsData";
import { loadTourFacts } from "../stats/insights";
import { loadRailStats } from "../rail/railStats";
import { loadBusStats } from "../bus/busStats";
import { rentalStatsFor } from "../rental/rentalStats";
import { calculateCruiseStats } from "../../utils/cruiseStats";
import { calculateLodgingStats } from "../../utils/lodgingStats";

export interface DomainFigures {
  values: Partial<Record<MetricKey, number | null>>;
  /** Metrics that are a lower bound. */
  partial: MetricKey[];
}
type Loader = (userId: string, year: number | null) => Promise<DomainFigures>;

/** Σ of the known values: 0 for no rows, null when no row knows it, partial when some do not. */
function sumKnown(values: ReadonlyArray<number | null>): {
  total: number | null;
  partial: boolean;
} {
  if (values.length === 0) return { total: 0, partial: false };
  const known = values.filter((v): v is number => v !== null);
  return {
    total: known.length ? known.reduce((s, v) => s + v, 0) : null,
    partial: known.length > 0 && known.length < values.length,
  };
}

const flight: Loader = async (userId, year) => {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { baseCurrency: true },
  });
  const where = await buildWhere(userId, undefined, undefined, year ?? undefined);
  const { stats } = await computeSummary(where, settings?.baseCurrency ?? "EUR");
  return {
    values: {
      flights: stats.totalFlights ?? null,
      flightKm: stats.totalDistance ?? null,
      flightMinutes: stats.totalFlightTime ?? null,
    },
    partial: [],
  };
};

const cruise: Loader = async (userId, year) => {
  const loaded = await loadCruiseStatsData(userId, year ?? undefined);
  const stats = calculateCruiseStats(
    loaded.rows.map((r) => r.input),
    loaded.userBirthday
  );
  return {
    values: {
      cruises: stats.cruisesCount,
      cruiseKm: stats.totalDistanceKm,
      cruisePorts: stats.cruisePortsUnique,
    },
    partial: [],
  };
};

const lodging: Loader = async (userId, year) => {
  const loaded = await loadLodgingStatsData(userId, year ?? undefined);
  const stats = calculateLodgingStats(loaded.stays, loaded.baseCurrency, loaded.lodgingRecords);
  return { values: { stays: stats.staysCount, nights: stats.totalNights }, partial: [] };
};

const rail: Loader = async (userId, year) => {
  const s = await loadRailStats(userId, year);
  const unknown = s.journeys > 0 && s.distance.unmeasuredJourneys === s.journeys;
  return {
    values: { railRides: s.journeys, railKm: unknown ? null : s.distance.totalKm },
    partial: !unknown && s.distance.unmeasuredJourneys > 0 ? ["railKm"] : [],
  };
};

const bus: Loader = async (userId, year) => {
  const s = await loadBusStats(userId, year);
  const unknown = s.rides > 0 && s.distance.unmeasuredRides === s.rides;
  return {
    values: { busRides: s.rides, busKm: unknown ? null : s.distance.totalKm },
    partial: !unknown && s.distance.unmeasuredRides > 0 ? ["busKm"] : [],
  };
};

const rental: Loader = async (userId, year) => {
  const s = await rentalStatsFor(userId, year);
  return {
    values: { rentals: s.rentals, rentalDays: s.days, rentalKm: s.km.total },
    partial: s.km.total !== null && s.km.covered < s.km.of ? ["rentalKm"] : [],
  };
};

const ferry: Loader = async (userId, year) => {
  const rows = await prisma.ferryJourney.findMany({
    where: { userId, ...countableFerryWhere() },
    select: {
      departureTime: true,
      arrivalTime: true,
      depTimezone: true,
      arrTimezone: true,
      distanceKm: true,
    },
  });
  const counted = year === null ? rows : rows.filter((r) => ferryYear(r) === year);
  const km = sumKnown(counted.map((r) => r.distanceKm));
  return {
    values: { ferryCrossings: counted.length, ferryKm: km.total },
    partial: km.partial ? ["ferryKm"] : [],
  };
};

/**
 * Day tours (`TripRoute` kind "tour") that happened, by `shared/tour/tourCounting`. A tour whose
 * recording was truncated at the import limit (`partial`) only knows a lower bound of its km,
 * so the total is one too (preflight R8).
 */
const roadtrip: Loader = async (userId, year) => {
  const done = (await loadTourFacts(userId, now(), { withElevation: false })).filter(
    (f) => f.state === "completed" && (year === null || f.year === year)
  );
  const km = sumKnown(done.map((f) => f.km));
  const truncated = done.some((f) => f.partial && f.km !== null);
  return {
    values: { tours: done.length, tourKm: km.total },
    partial: km.partial || (km.total !== null && truncated) ? ["tourKm"] : [],
  };
};

const poi: Loader = async (userId, year) => {
  const places = await prisma.place.findMany({
    where: { userId },
    select: {
      visited: true,
      visits: { select: { visitedAt: true, visitedAtUtc: true, visitedZone: true } },
    },
  });
  const at = now();
  if (year === null) {
    const visited = places.filter(
      (p) =>
        classifyPlace({
          visited: p.visited,
          plannedVisitCount: p.visits.filter((v) => classifyVisit(v, at) === "planned").length,
        }) === "visited"
    );
    return {
      values: {
        places: visited.length,
        placeVisits: places.reduce((n, p) => n + countCompletedVisits(p.visits, at), 0),
      },
      partial: [],
    };
  }
  const perPlace = places.map(
    (p) => p.visits.filter((v) => visitCountsForYear(v, year, at)).length
  );
  return {
    values: {
      placeVisits: perPlace.reduce((s, n) => s + n, 0),
      places: perPlace.filter((n) => n > 0).length,
    },
    partial: [],
  };
};

export const DOMAIN_AGGREGATES: Record<DomainKey, Loader> = {
  flight,
  cruise,
  lodging,
  poi,
  roadtrip,
  rail,
  rental,
  bus,
  ferry,
};
