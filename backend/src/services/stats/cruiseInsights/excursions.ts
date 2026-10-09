/**
 * Shore excursions per cruise (forgejo#257): what was documented ashore, from
 * the data the user already keeps — the excursion note on a port call, and
 * the day tours they recorded. No new field, nothing to fill in.
 *
 * ## When a tour belongs to a port call
 *
 * There is no stored link between a tour and a cruise, so the link is a rule,
 * stated in the help: a day tour (`TripRoute.kind = "tour"`) is a shore
 * excursion of a port call when its own day (`tourDate`, the place's local
 * day) is the call's local day AND it starts within `EXCURSION_LINK_KM` of the
 * port — its first positioned station, else the first point of its first
 * recording. A tour with no day or no position links to nothing; an
 * unresolved port has no position and takes no tour. One tour belongs to at
 * most one call (the nearest that day).
 *
 * ## Abstention
 *
 * A cruise with no note and no linked tour has NO DOCUMENTED excursion — not
 * "0 excursions": nobody wrote down that they stayed aboard. Distance and
 * climb are summed only over tours that measured them, and stay null where
 * none did. Recorded and planned kilometres are summed apart: a tour counts
 * its recording where it has one, its planned legs otherwise, never both. Tours sit behind the instance's roadtrip/tour beta switch; while
 * the reader does not see tours, no tour is linked or counted and the section
 * says so (`toursVisible: false`).
 */

import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { haversineKm } from "../../../shared/geo/haversine";
import { travelledKm } from "../../tour/tourDistance";
import type { CruiseCall, CruiseInsightRow } from "./rows";
import type { TourFacts } from "../../../utils/tourInsights/tourFacts";

/** How far from the port a tour may start and still be that call's excursion. */
export const EXCURSION_LINK_KM = 100; // threshold: proposal forgejo#257, owner to confirm

/** Activities measured on foot — the "walking distance" of the issue. */
const ON_FOOT = new Set(["hike", "walk", "run", "climb"]);

export interface ExcursionTour {
  id: string;
  name: string;
  activity: string | null;
  day: string;
  start: { lat: number; lon: number } | null;
  /**
   * Kilometres RECORDED (the tour's tracks) — or, for a tour with no
   * recording, kilometres PLANNED (its legs). Exactly one of the two is set
   * where anything was measured, so the sums below never add a plan to a
   * recording. A recording of 0 km measured nothing and counts as none.
   */
  recordedKm: number | null;
  plannedKm: number | null;
  ascentM: number | null;
}

const sumOrNull = (values: ReadonlyArray<number | null>): number | null => {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

const positive = (km: number): number | null => (km > 0 ? km : null);

/**
 * The first recorded point of each tour's first track, for tours that have no
 * positioned station. Read in SQL so only that one point crosses the wire,
 * never the whole line (`geometry` is `[[lon, lat], …]`).
 */
async function firstTrackPoints(
  routeIds: readonly string[]
): Promise<Map<string, { lat: number; lon: number }>> {
  if (routeIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ route_id: string; lon: number | null; lat: number | null }>
  >(Prisma.sql`
    SELECT DISTINCT ON (route_id) route_id,
      (geometry->0->>0)::float8 AS lon, (geometry->0->>1)::float8 AS lat
    FROM trip_route_tracks
    WHERE route_id IN (${Prisma.join([...routeIds])})
    ORDER BY route_id, started_at ASC`);
  return new Map(
    rows
      .filter((r) => r.lat !== null && r.lon !== null)
      .map((r) => [r.route_id, { lat: r.lat as number, lon: r.lon as number }])
  );
}

/** The user's day tours that fall on one of `days`, with what links and measures them. */
export async function loadExcursionTours(
  userId: string,
  days: readonly string[]
): Promise<ExcursionTour[]> {
  if (days.length === 0) return [];
  const tours = await prisma.tripRoute.findMany({
    where: {
      userId,
      kind: "tour",
      tourDate: { in: [...new Set(days)].map((d) => new Date(`${d}T00:00:00Z`)) },
    },
    select: {
      id: true,
      name: true,
      activity: true,
      tourDate: true,
      stops: {
        where: { viaPoint: false, lat: { not: null }, lon: { not: null } },
        select: { lat: true, lon: true },
        orderBy: [{ routeOrderIdx: "asc" }, { orderIdx: "asc" }],
        take: 1,
      },
      tracks: { select: { distanceKm: true, ascentM: true } },
      legs: { select: { distanceKm: true } },
    },
    orderBy: { id: "asc" },
  });
  if (tours.length === 0) return [];
  const fallback = await firstTrackPoints(
    tours.filter((t) => t.stops.length === 0 && t.tracks.length > 0).map((t) => t.id)
  );
  return tours.map((t) => {
    const stop = t.stops[0];
    const recorded =
      t.tracks.length > 0 ? positive(t.tracks.reduce((sum, k) => sum + k.distanceKm, 0)) : null;
    return {
      id: t.id,
      name: t.name,
      activity: t.activity,
      day: t.tourDate!.toISOString().slice(0, 10),
      start:
        stop && stop.lat !== null && stop.lon !== null
          ? { lat: stop.lat, lon: stop.lon }
          : (fallback.get(t.id) ?? null),
      recordedKm: recorded,
      plannedKm: recorded === null ? positive(travelledKm(t.legs)) : null,
      ascentM: sumOrNull(t.tracks.map((k) => k.ascentM)),
    };
  });
}

/**
 * The same excursion candidates as `loadExcursionTours`, made from tours the
 * caller already loaded (`utils/tourInsights`' tour facts) — the badge check
 * loads the tours once and hands them to both the tour badges and these
 * (integration of forgejo#257 with #264). Same rule: the tour's own day
 * (`tourDate`) is one of `days`, it starts at its first positioned station,
 * else at its recording's first point.
 */
export async function excursionToursFromFacts(
  facts: readonly TourFacts[],
  days: readonly string[]
): Promise<ExcursionTour[]> {
  const wanted = new Set(days);
  const onDay = facts.filter(
    (f) => f.tour.tourDate !== null && wanted.has(f.tour.tourDate.toISOString().slice(0, 10))
  );
  if (onDay.length === 0) return [];
  const fallback = await firstTrackPoints(
    onDay.filter((f) => f.tour.start === null && f.tour.tracks.length > 0).map((f) => f.tour.id)
  );
  return onDay.map(({ tour }) => {
    const recorded =
      tour.tracks.length > 0
        ? positive(tour.tracks.reduce((sum, k) => sum + k.distanceKm, 0))
        : null;
    return {
      id: tour.id,
      name: tour.name,
      activity: tour.activity,
      day: tour.tourDate!.toISOString().slice(0, 10),
      start: tour.start ?? fallback.get(tour.id) ?? null,
      recordedKm: recorded,
      plannedKm: recorded === null ? positive(tour.routeKm) : null,
      ascentM: sumOrNull(tour.tracks.map((k) => k.ascentM)),
    };
  });
}

export interface LinkedTour extends ExcursionTour {
  stopId: string;
  portName: string;
}

/** Each tour to the nearest port call of its day within reach, or to nothing. */
export function linkTours(
  rows: readonly CruiseInsightRow[],
  tours: readonly ExcursionTour[]
): Map<string, LinkedTour[]> {
  const byCruise = new Map<string, LinkedTour[]>();
  for (const tour of tours) {
    if (!tour.start) continue;
    let best: { row: CruiseInsightRow; call: CruiseCall; km: number } | null = null;
    for (const row of rows) {
      for (const call of row.calls) {
        if (call.isAtSea || call.day !== tour.day || call.lat === null || call.lon === null)
          continue;
        const km = haversineKm(tour.start, { lat: call.lat, lon: call.lon });
        if (km <= EXCURSION_LINK_KM && (best === null || km < best.km)) best = { row, call, km };
      }
    }
    if (best) {
      const linked: LinkedTour = {
        ...tour,
        stopId: best.call.stopId,
        portName: best.call.portName ?? "",
      };
      byCruise.set(best.row.id, [...(byCruise.get(best.row.id) ?? []), linked]);
    }
  }
  return byCruise;
}

export interface CruiseExcursions {
  cruiseId: string;
  /** Port calls (sea days excluded). */
  calls: number;
  notedCalls: number;
  /** Null while the reader does not see tours. */
  tours: LinkedTour[] | null;
  /** Calls with a note or a linked tour — the documented excursions. */
  documentedStopIds: string[];
  /** Catalogue ports among them, for the badge. */
  documentedPortIds: number[];
  activities: Record<string, number> | null;
  /** Recorded and planned kilometres, summed apart — never one figure. */
  recordedKm: number | null;
  plannedKm: number | null;
  onFootRecordedKm: number | null;
  onFootPlannedKm: number | null;
  ascentM: number | null;
}

export function excursionsOf(
  row: CruiseInsightRow,
  linked: readonly LinkedTour[] | null
): CruiseExcursions {
  const portCalls = row.calls.filter((c) => !c.isAtSea && c.portName !== null);
  const tourStops = new Set((linked ?? []).map((t) => t.stopId));
  const documented = portCalls.filter((c) => c.excursionNote !== null || tourStops.has(c.stopId));
  const onFoot = (linked ?? []).filter((t) => ON_FOOT.has(t.activity ?? ""));
  const activities: Record<string, number> = {};
  for (const tour of linked ?? []) {
    const key = tour.activity ?? "unspecified";
    activities[key] = (activities[key] ?? 0) + 1;
  }
  return {
    cruiseId: row.id,
    calls: portCalls.length,
    notedCalls: portCalls.filter((c) => c.excursionNote !== null).length,
    tours: linked === null ? null : [...linked],
    documentedStopIds: documented.map((c) => c.stopId),
    documentedPortIds: [
      ...new Set(documented.map((c) => c.portId).filter((id): id is number => id !== null)),
    ],
    activities: linked === null ? null : activities,
    recordedKm: linked === null ? null : sumOrNull(linked.map((t) => t.recordedKm)),
    plannedKm: linked === null ? null : sumOrNull(linked.map((t) => t.plannedKm)),
    onFootRecordedKm: linked === null ? null : sumOrNull(onFoot.map((t) => t.recordedKm)),
    onFootPlannedKm: linked === null ? null : sumOrNull(onFoot.map((t) => t.plannedKm)),
    ascentM: linked === null ? null : sumOrNull(linked.map((t) => t.ascentM)),
  };
}
