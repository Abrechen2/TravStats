import { prisma } from "../../db";
import { getCountryResolver } from "../geo/countryFromCoordinates";
import { travelledKm } from "../tour/tourDistance";
import {
  STATION_SELECT,
  nightsOf,
  spanOf,
  stationCountries,
  toRoadtripSummary,
} from "./roadtripSummary";

/**
 * The roadtrip list (`GET /roadtrips`) — loaded here so the list and the
 * evidence panel behind the statistics tab's roadtrip tiles
 * (`services/evidence/metricEvidenceRoadtrip.ts`) read the same rows through
 * the same derivation, and a panel cannot name a roadtrip the tile never saw.
 */
export const ROADTRIP_LIST_SELECT = {
  id: true,
  tripId: true,
  name: true,
  mode: true,
  color: true,
  vehicle: true,
  vehicleName: true,
  kindAssignedAutomatically: true,
  startOdometerKm: true,
  endOdometerKm: true,
  trip: { select: { name: true } },
  legs: { select: { mode: true, distanceKm: true } },
  stops: { select: STATION_SELECT, orderBy: { routeOrderIdx: "asc" } },
  _count: { select: { tracks: true } },
} as const;

/** How many day tours set out from each roadtrip's stations. */
async function tourCountsByRoadtrip(userId: string, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const tours = await prisma.tripRoute.findMany({
    where: { userId, kind: "tour", anchorStop: { routeId: { in: ids } } },
    select: { anchorStop: { select: { routeId: true } } },
  });
  const counts = new Map<string, number>();
  for (const t of tours) {
    const id = t.anchorStop?.routeId;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Every roadtrip of a user as the list answers it — newest first by the span its stations cover. */
export async function loadRoadtripSummaries(userId: string): Promise<Record<string, unknown>[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: ROADTRIP_LIST_SELECT,
  });
  const tourCounts = await tourCountsByRoadtrip(
    userId,
    rows.map((r) => r.id)
  );
  const resolver = rows.length > 0 ? await getCountryResolver() : null;
  return (
    rows
      .map((r) =>
        toRoadtripSummary(
          r,
          tourCounts.get(r.id) ?? 0,
          resolver ? stationCountries(r.stops, resolver) : []
        )
      )
      // Sort-then-return: the order key is derived from the stations and
      // cannot be pushed into the query. Undated ones go last.
      .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")))
  );
}

/**
 * What the statistics tab's roadtrip tiles read off one list row, typed: the
 * same derivations `toRoadtripSummary` answers the list with (`spanOf`,
 * `travelledKm`, `nightsOf`, `stationCountries`), so the evidence panel and
 * the tile agree by construction.
 */
export interface RoadtripListFacts {
  id: string;
  name: string;
  vehicle: string | null;
  /** ISO instant of the span start, or null for an undated roadtrip. */
  startDate: string | null;
  distanceKm: number;
  nights: number;
  stayNights: number;
  freeNights: number;
  nightsKnown: boolean;
  countries: string[];
}

export async function loadRoadtripListFacts(userId: string): Promise<RoadtripListFacts[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      id: true,
      name: true,
      vehicle: true,
      legs: ROADTRIP_LIST_SELECT.legs,
      stops: ROADTRIP_LIST_SELECT.stops,
    },
  });
  const resolver = rows.length > 0 ? await getCountryResolver() : null;
  return rows.map((r) => {
    const nights = nightsOf(r.stops);
    return {
      id: r.id,
      name: r.name,
      vehicle: r.vehicle,
      startDate: spanOf(r.stops).startDate,
      distanceKm: travelledKm(r.legs),
      nights: nights.nights,
      stayNights: nights.stayNights,
      freeNights: nights.freeNights,
      nightsKnown: nights.nightsKnown,
      countries: resolver ? stationCountries(r.stops, resolver) : [],
    };
  });
}
