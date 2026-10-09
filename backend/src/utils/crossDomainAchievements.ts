import type { Achievement } from "../prisma";
import { prisma } from "../db";
import { classifyStay } from "../shared/lodgingCounting";
import { classifyVisit } from "../shared/placeCounting";
import { arrivedOverland, tripMovementModes, type DomainCounts } from "../shared/tripMovement";
import { roadtripAttestedSpan, type RoadtripStationRow } from "../services/stats/roadtripEvidence";
import { BETA_GATED_DOMAINS, loadVisibleDomains } from "../services/domainVisibility";
import { now as clockNow } from "../shared/time/clock";

/**
 * The shared, cross-domain trip badges (forgejo#265), measured per trip from
 * entries EXPLICITLY on that trip — a flight in one trip and a stay in another
 * never combine, the rule `computeFlyAndStayFlags` set for Fly & Stay.
 *
 *  - three modes of moving on one completed trip (`shared/tripMovement.ts`;
 *    a rental contract is no movement of its own);
 *  - arriving by train or coach AND a stay that is over AND a place visit
 *    that happened, on the same trip — the ground-travel sibling of Fly & Stay;
 *  - the fully documented trip ("Lückenlos festgehalten", "Chronist"): a real
 *    movement of ANY mode, a stay, a journal entry and a photo. It moved here
 *    from `achievements.ts`, which counted flights and cruises only, so a
 *    train or coach trip with every page filled in never qualified.
 *
 * A beta domain that is switched off contributes nothing; a domain the user
 * merely switched off counts as before (see `shared/tripMovement.ts`).
 */

export interface CrossDomainAchievementStats {
  tripsThreeModes: number;
  tripsArriveAndDiscover: number;
  tripsFullyDocumented: number;
}

export const EMPTY_CROSS_DOMAIN_STATS: CrossDomainAchievementStats = {
  tripsThreeModes: 0,
  tripsArriveAndDiscover: 0,
  tripsFullyDocumented: 0,
};

const STATUS = { select: { status: true } } as const;

export const CROSS_DOMAIN_TRIP_SELECT = {
  status: true,
  flights: STATUS,
  cruises: STATUS,
  railJourneys: STATUS,
  busJourneys: STATUS,
  lodgingStays: { select: { status: true, checkIn: true, checkOut: true } },
  placeVisits: { select: { visitedAt: true, visitedAtUtc: true } },
  routes: {
    where: { kind: "roadtrip" },
    select: {
      stops: {
        where: { viaPoint: false },
        // What `attestStation` reads: an undated or planned station moves nobody.
        select: {
          lodgingStayId: true,
          overnight: true,
          startDate: true,
          endDate: true,
          lodgingStay: {
            select: {
              checkIn: true,
              checkOut: true,
              datePrecision: true,
              nights: true,
              status: true,
            },
          },
        },
      },
    },
  },
  _count: { select: { journalEntries: true, photos: true } },
} as const;

export interface CrossDomainTripRow {
  status: string;
  flights: { status: string }[];
  cruises: { status: string }[];
  railJourneys: { status: string }[];
  busJourneys: { status: string }[];
  lodgingStays: { status: string; checkIn: Date | null; checkOut: Date | null }[];
  placeVisits: { visitedAt: Date | null; visitedAtUtc: Date | null }[];
  routes: { stops: RoadtripStationRow[] }[];
  _count: { journalEntries: number; photos: number };
}

/** Pure fold over a user's trips. */
export function foldCrossDomainAchievementStats(
  trips: readonly CrossDomainTripRow[],
  counts: DomainCounts,
  now: Date
): CrossDomainAchievementStats {
  const stats = { ...EMPTY_CROSS_DOMAIN_STATS };
  for (const trip of trips) {
    // A roadtrip moved the traveller only when a station ATTESTS a day — dated,
    // not planned, not a cancelled stay (review I1): an empty or undated
    // roadtrip draft is no mode of travel.
    const startedRoadtrips = trip.routes.filter(
      (route) => roadtripAttestedSpan(route.stops, now) !== null
    ).length;
    const modes = tripMovementModes({ ...trip, startedRoadtrips }, counts);
    const stayed =
      counts("lodging") && trip.lodgingStays.some((s) => classifyStay(s, now) === "visited");
    const discovered =
      counts("poi") && trip.placeVisits.some((v) => classifyVisit(v, now) === "visited");

    if (trip.status === "completed" && modes.size >= 3) stats.tripsThreeModes += 1;
    if (arrivedOverland(modes) && stayed && discovered) stats.tripsArriveAndDiscover += 1;
    if (modes.size > 0 && stayed && trip._count.journalEntries > 0 && trip._count.photos > 0) {
      stats.tripsFullyDocumented += 1;
    }
  }
  return stats;
}

/** Everything but a beta domain that is switched off may count (see the header). */
export function badgeDomainCounts(visible: readonly string[]): DomainCounts {
  const seen = new Set(visible);
  return (domain) => BETA_GATED_DOMAINS[domain] === undefined || seen.has(domain);
}

export async function calculateCrossDomainAchievementStats(
  userId: string
): Promise<CrossDomainAchievementStats> {
  const [trips, visible] = await Promise.all([
    prisma.trip.findMany({ where: { userId }, select: CROSS_DOMAIN_TRIP_SELECT }),
    loadVisibleDomains(userId),
  ]);
  return foldCrossDomainAchievementStats(trips, badgeDomainCounts(visible), clockNow());
}

const MEASURE: Record<string, keyof CrossDomainAchievementStats> = {
  trips_three_modes: "tripsThreeModes",
  trips_arrive_and_discover: "tripsArriveAndDiscover",
  trips_fully_documented: "tripsFullyDocumented",
};

export const CROSS_DOMAIN_REQUIREMENT_TYPES: readonly string[] = Object.keys(MEASURE);

/** The badge's progress, or `null` when it is not one of these. */
export function checkCrossDomainAchievement(
  achievement: Pick<Achievement, "requirementType" | "requirement">,
  stats: CrossDomainAchievementStats
): { isUnlocked: boolean; progress: number } | null {
  const key = MEASURE[achievement.requirementType];
  if (!key) return null;
  const progress = stats[key];
  return { isUnlocked: progress >= achievement.requirement, progress };
}
