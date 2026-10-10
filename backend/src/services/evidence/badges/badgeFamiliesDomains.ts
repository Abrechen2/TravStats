import { prisma } from "../../../db";
import type { EvidenceEntry } from "../../../schemas/evidence";
import { now as clockNow } from "../../../shared/time/clock";
import { loadVisibleDomains } from "../../domainVisibility";
import { checkAchievement } from "../../../utils/achievementChecks";
import type { UserStats } from "../../../utils/achievementStats";
import type { Achievement } from "../../../prisma";
import {
  checkRailAchievement,
  foldRailAchievementStats,
  loadRailBadgeRows,
  RAIL_REQUIREMENT_TYPES,
} from "../../../utils/railAchievements";
import {
  badgeDomainCounts,
  checkCrossDomainAchievement,
  CROSS_DOMAIN_REQUIREMENT_TYPES,
  CROSS_DOMAIN_TRIP_SELECT,
  foldCrossDomainAchievementStats,
} from "../../../utils/crossDomainAchievements";
import {
  checkRoadtripAchievement,
  roadtripBadgeStats,
  ROADTRIP_REQUIREMENT_TYPES,
} from "../../../utils/roadtripAchievements";
import {
  checkInsightAchievement,
  EMPTY_INSIGHT_STATS,
  foldCruiseInsightStats,
  foldFlightInsightStats,
  lodgingBadgeFields,
  placeBadgeFields,
  tourBadgeFields,
  type InsightAchievementStats,
} from "../../../utils/insightAchievements";
import { computeLodgingInsights } from "../../../utils/lodgingInsights";
import { computePlaceInsights } from "../../../utils/placeInsights";
import { computeRoadtripInsights } from "../../../utils/roadtripInsights";
import { computeTourInsights } from "../../../utils/tourInsights";
import { getCountryResolver } from "../../geo/countryFromCoordinates";
import { loadTourFacts } from "../../stats/insights";
import { loadLodgingInsightStays } from "../../stats/insights/lodgingInsightData";
import { loadPlaceInsightPlaces } from "../../stats/insights/placeInsightData";
import { loadInsightRoadtrips } from "../../stats/insights/roadtripInsightData";
import { toFlightInsightRows } from "../../stats/flightInsights/rows";
import { cruiseInsightContextOf } from "../../stats/cruiseInsights/load";
import { cruiseInsightRowOf } from "../../stats/cruiseInsights/rows";
import { computeCoreStats, loadCoreInputs } from "../../../utils/achievementInputs";
import {
  placeEvidenceEntry,
  railEvidenceEntry,
  roadtripEvidenceEntry,
  stayEvidenceEntry,
  tripEvidenceEntry,
} from "../entryMappersDomains";
import { coreFamily } from "./badgeFamiliesCore";
import {
  erase,
  progressOf,
  type BadgeFamily,
  type BadgeRule,
  type ErasedFamily,
} from "./badgeFamily";

/**
 * The badges measured outside `checkAchievement`: rail, the cross-domain trip
 * badges, roadtrips and the statistics-expansion badges. Each family folds a
 * subset of its rows through the badge's own fold — `foldRailAchievementStats`,
 * `foldCrossDomainAchievementStats`, the statistics builders — and asks the
 * badge's own check.
 */

type Entry = Omit<EvidenceEntry, "contribution">;
const entryAs = <R>(
  rows: readonly R[],
  entryOf: (row: R) => Entry,
  progress: BadgeFamily<R>["progress"]
): ErasedFamily => erase({ rows, entryOf, progress });

const insight = (rule: BadgeRule, fields: Partial<InsightAchievementStats>): number =>
  progressOf(checkInsightAchievement(rule, { ...EMPTY_INSIGHT_STATS, ...fields }));

/** A day tour has no evidence domain of its own: it is a route and opens its own page. */
const tourEntry = (tour: { id: string; name: string; tourDate: Date | null }): Entry => ({
  ...roadtripEvidenceEntry(
    { id: tour.id, name: tour.name, startDate: tour.tourDate },
    { subtitle: null }
  ),
  href: `/tours/${tour.id}`,
});

async function railFamily(userId: string, rule: BadgeRule) {
  const rows = await loadRailBadgeRows(userId);
  return entryAs(
    rows,
    (r) =>
      railEvidenceEntry(
        {
          id: r.id,
          label: `${r.depStationName} → ${r.arrStationName}`,
          departureTime: r.departureTime,
          depTimezone: r.depTimezone,
        },
        { subtitle: null }
      ),
    async (subset) => progressOf(checkRailAchievement(rule, foldRailAchievementStats(subset)))
  );
}

async function tripFamily(userId: string, rule: BadgeRule) {
  const [trips, visible] = await Promise.all([
    prisma.trip.findMany({
      where: { userId },
      select: { id: true, name: true, startDate: true, ...CROSS_DOMAIN_TRIP_SELECT },
    }),
    loadVisibleDomains(userId),
  ]);
  const counts = badgeDomainCounts(visible);
  const at = clockNow();
  return entryAs(
    trips,
    (t) =>
      tripEvidenceEntry({ id: t.id, name: t.name, startDate: t.startDate }, { subtitle: null }),
    async (subset) => {
      const stats = foldCrossDomainAchievementStats(subset, counts, at);
      // The fully documented trip is filed under `UserStats` and checked there.
      return rule.requirementType === "trips_fully_documented"
        ? checkAchievement(
            rule as Achievement,
            { tripsFullyDocumented: stats.tripsFullyDocumented } as UserStats,
            []
          ).progress
        : progressOf(checkCrossDomainAchievement(rule, stats));
    }
  );
}

async function roadtripFamily(userId: string, rule: BadgeRule) {
  const at = clockNow();
  const [roadtrips, tours, resolver] = await Promise.all([
    loadInsightRoadtrips(userId),
    loadTourFacts(userId, at, { withElevation: false }),
    getCountryResolver(),
  ]);
  return entryAs(
    roadtrips,
    (r) => {
      const first = r.stations
        .map((s) => s.startDate)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return roadtripEvidenceEntry(
        { id: r.id, name: r.name, startDate: first ?? null },
        { subtitle: null }
      );
    },
    async (subset) =>
      progressOf(
        checkRoadtripAchievement(
          rule,
          roadtripBadgeStats(computeRoadtripInsights(subset, tours, resolver, at).insights.awards)
        )
      )
  );
}

async function flightInsightFamily(userId: string, rule: BadgeRule) {
  const { flights } = await loadCoreInputs(userId);
  const byId = new Map(flights.map((f) => [f.id, f]));
  const rows = await toFlightInsightRows(flights);
  return entryAs(
    rows,
    (r) => {
      const f = byId.get(r.id);
      return {
        domain: "flight",
        id: r.id,
        href: `/flights/${r.id}`,
        title: { text: r.flightNumber ?? "—" },
        subtitle: { text: `${r.depCode ?? "?"} → ${r.arrCode ?? "?"}` },
        date: f?.departureTime
          ? { value: f.departureTime.toISOString().slice(0, 10), precision: "day" }
          : null,
      };
    },
    async (subset) => insight(rule, foldFlightInsightStats(subset))
  );
}

async function cruiseInsightFamily(userId: string, rule: BadgeRule) {
  const inputs = await loadCoreInputs(userId);
  const { cruiseStatsInput, userBirthday } = await computeCoreStats(inputs, {
    countries: async (floor) => new Set(floor),
    tripsFullyDocumented: 0,
  });
  const at = clockNow();
  const tours = await loadTourFacts(userId, at, { withElevation: false });
  const rows = inputs.cruises.map((c, i) =>
    cruiseInsightRowOf({ id: c.id, label: "", input: cruiseStatsInput[i] }, c.stops)
  );
  const ctx = await cruiseInsightContextOf(userId, { rows, userBirthday }, { tours });
  const byId = new Map(inputs.cruises.map((c) => [c.id, c]));
  return entryAs(
    rows,
    (r) => {
      const c = byId.get(r.id);
      return {
        domain: "cruise",
        id: r.id,
        href: `/cruises/${r.id}`,
        title: { text: c?.routeName ?? c?.shipNameOverride ?? c?.cruiseLine ?? "—" },
        subtitle: null,
        date: r.startDay ? { value: r.startDay, precision: "day" } : null,
      };
    },
    async (subset) => insight(rule, foldCruiseInsightStats({ ...ctx, rows: [...subset] }))
  );
}

async function lodgingInsightFamily(userId: string, rule: BadgeRule) {
  const at = clockNow();
  const rows = await loadLodgingInsightStays(userId);
  return entryAs(
    rows,
    (s) =>
      stayEvidenceEntry(
        { id: s.id, lodgingId: s.lodgingId, lodgingName: s.lodgingName, checkIn: s.checkIn },
        { subtitle: null }
      ),
    async (subset) => insight(rule, lodgingBadgeFields(computeLodgingInsights(subset, at).insights))
  );
}

async function placeInsightFamily(userId: string, rule: BadgeRule) {
  const at = clockNow();
  const rows = await loadPlaceInsightPlaces(userId);
  return entryAs(
    rows,
    (p) =>
      placeEvidenceEntry(
        { id: p.id, placeId: p.id, placeName: p.name, visitedAt: p.visits[0]?.visitedAt ?? null },
        { subtitle: null }
      ),
    async (subset) => insight(rule, placeBadgeFields(computePlaceInsights(subset, at).insights))
  );
}

async function tourInsightFamily(userId: string, rule: BadgeRule) {
  const rows = await loadTourFacts(userId, clockNow(), { withElevation: false });
  return entryAs(
    rows,
    (t) => tourEntry(t.tour),
    async (subset) => insight(rule, tourBadgeFields(computeTourInsights(subset).insights))
  );
}

const INSIGHT_FAMILIES: Array<
  [string, (userId: string, rule: BadgeRule) => Promise<ErasedFamily>]
> = [
  ["flight_", flightInsightFamily],
  ["cruise_", cruiseInsightFamily],
  ["lodging_", lodgingInsightFamily],
  ["place_", placeInsightFamily],
  ["tour_", tourInsightFamily],
];

/** The statistics-expansion badges, by the domain their name starts with. */
const INSIGHT_TYPES = [
  "flight_new_airports_year",
  "flight_airport_reunion_years",
  "flight_airport_all_quarters",
  "cruise_port_cruises",
  "cruise_excursion_ports",
  "cruise_repeated_itinerary",
  "lodging_trip_types_max",
  "lodging_same_house_years",
  "lodging_months_in_year",
  "place_revisit_gap_years",
  "place_trip_categories_max",
  "place_documented_visits",
  "tour_count",
  "tour_activities_unique",
  "tour_ascent_m",
];

/** Every requirement type a domain family answers. */
export const DOMAIN_REQUIREMENT_TYPES: readonly string[] = [
  ...RAIL_REQUIREMENT_TYPES,
  ...CROSS_DOMAIN_REQUIREMENT_TYPES,
  "trips_fully_documented",
  ...ROADTRIP_REQUIREMENT_TYPES,
  ...INSIGHT_TYPES,
];

/** The family a badge is measured in, loaded — null when no family answers it. */
export async function loadBadgeFamily(
  userId: string,
  rule: BadgeRule,
  coreArrays: Parameters<typeof coreFamily>[1] | null
): Promise<ErasedFamily | null> {
  const type = rule.requirementType;
  if (coreArrays) {
    const inputs = await loadCoreInputs(userId);
    // The two outside lookups of the core fold are not the subject of any
    // core badge but `countries`, which has its own evidence.
    return erase(
      await coreFamily(rule, coreArrays, inputs, {
        countries: async (floor) => new Set(floor),
        tripsFullyDocumented: 0,
      })
    );
  }
  if (RAIL_REQUIREMENT_TYPES.includes(type)) return railFamily(userId, rule);
  if (CROSS_DOMAIN_REQUIREMENT_TYPES.includes(type) || type === "trips_fully_documented") {
    return tripFamily(userId, rule);
  }
  if (ROADTRIP_REQUIREMENT_TYPES.includes(type)) return roadtripFamily(userId, rule);
  if (INSIGHT_TYPES.includes(type)) {
    const family = INSIGHT_FAMILIES.find(([prefix]) => type.startsWith(prefix));
    return family ? family[1](userId, rule) : null;
  }
  return null;
}
