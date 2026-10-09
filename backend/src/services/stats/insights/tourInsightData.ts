import { prisma } from "../../../db";
import { zoneOf } from "../../../shared/time/zoneOf";
import { isValidZone } from "../../../shared/time/zonedParts";
import type { CountryResolver } from "../../geo/countryFromCoordinates";
import type { InsightTour } from "../../../utils/tourInsights/tourFacts";

/** The highest metres value of an elevation profile (`[km, metres]` pairs), or null. */
export function profileMax(elevations: unknown): number | null {
  if (!Array.isArray(elevations)) return null;
  let max: number | null = null;
  for (const pair of elevations) {
    const metres = Array.isArray(pair) ? Number(pair[1]) : NaN;
    if (Number.isFinite(metres) && (max === null || metres > max)) max = metres;
  }
  return max;
}

function zoneAt(
  stop: { stopZone: string | null; lat: number | null; lon: number | null } | undefined
): string | null {
  if (!stop) return null;
  if (stop.stopZone && isValidZone(stop.stopZone)) return stop.stopZone;
  if (stop.lat === null || stop.lon === null) return null;
  try {
    return zoneOf({ lat: stop.lat, lon: stop.lon });
  } catch {
    // The zone service being unavailable is not a fact about the tour: "today"
    // is then asked in UTC, at worst a few hours off at the date line.
    return null;
  }
}

/**
 * Every day tour of a user, with what the tour statistics read (forgejo#264)
 * and the station it set out from (#260). A guided excursion is a tour like
 * any other here: its coach is how the tour moves, never a bus ride.
 */
export async function loadInsightTours(
  userId: string,
  resolver: Pick<CountryResolver, "countryAt">,
  /**
   * The elevation profiles are the bulk of a track row and serve one figure,
   * the highest point. The badge re-check runs inside every save and needs
   * none of it, so it asks without (review I4).
   */
  { withElevation = true }: { withElevation?: boolean } = {}
): Promise<InsightTour[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "tour" },
    select: {
      id: true,
      name: true,
      activity: true,
      tourDate: true,
      tripId: true,
      trip: {
        select: {
          name: true,
          cruises: { select: { startDate: true, endDate: true, status: true } },
        },
      },
      anchorStopId: true,
      anchorStop: { select: { routeId: true, route: { select: { kind: true } } } },
      legs: { select: { distanceKm: true } },
      tracks: {
        select: {
          startedAt: true,
          endedAt: true,
          distanceKm: true,
          ascentM: true,
          movingSeconds: true,
          elevations: withElevation,
          truncated: true,
        },
      },
      stops: {
        select: { lat: true, lon: true, stopZone: true },
        where: { viaPoint: false },
        orderBy: { routeOrderIdx: "asc" },
        take: 1,
      },
    },
  });
  return rows.map((r) => {
    const first = r.stops[0];
    const day = r.tourDate ? r.tourDate.toISOString().slice(0, 10) : null;
    const duringCruise =
      day !== null &&
      (r.trip?.cruises ?? []).some(
        (c) =>
          c.status !== "cancelled" &&
          c.startDate !== null &&
          c.endDate !== null &&
          c.startDate.toISOString().slice(0, 10) <= day &&
          day <= c.endDate.toISOString().slice(0, 10)
      );
    return {
      id: r.id,
      name: r.name,
      activity: r.activity,
      tourDate: r.tourDate,
      zone: zoneAt(first),
      tripId: r.tripId,
      tripName: r.trip?.name ?? null,
      anchorStopId: r.anchorStopId,
      anchorRoadtripId:
        r.anchorStop?.route?.kind === "roadtrip" ? (r.anchorStop.routeId ?? null) : null,
      duringCruise,
      country:
        first && first.lat !== null && first.lon !== null
          ? resolver.countryAt(first.lat, first.lon)
          : null,
      routeKm: r.legs.reduce((s, l) => s + l.distanceKm, 0),
      tracks: r.tracks.map((t) => ({
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        distanceKm: t.distanceKm,
        ascentM: t.ascentM,
        movingSeconds: t.movingSeconds,
        maxElevationM: withElevation ? profileMax(t.elevations) : null,
        truncated: t.truncated,
      })),
    };
  });
}
