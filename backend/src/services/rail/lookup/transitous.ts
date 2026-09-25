import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import logger from "../../../utils/logger";
import { decodePolyline, type LonLat } from "../railGeometryMath";
import { fetchRailJson } from "./railHttp";
import { isOnDay, labelMatches, nearestStop } from "./trainNumber";
import type { ProviderResult, ProviderStop, RailLookupQuery } from "./types";

/**
 * Transitous (MOTIS, https://transitous.org) — the first provider of the
 * chain: Europe-wide, keyless, and the only one that traces a trip's line.
 *
 * Terms honoured here (https://transitous.org/api/): open-source and
 * non-commercial use, a User-Agent with contact details (railHttp.ts), answers
 * cached, only the ordinary timetable endpoints (stoptimes, trip), no SLA
 * assumed. The UI links its sources page.
 *
 * There is no "find train by number" endpoint, so the lookup reads the
 * boarding station's departures of that day and picks the train by its label.
 * The day is read in four-hour windows and stops at the first match, because
 * a whole day of long-distance departures at Frankfurt Hbf is ~1.6 MB.
 */
export const TRANSITOUS_BASE_URL = "https://api.transitous.org";
export const TRANSITOUS_SOURCES_URL = "https://transitous.org/sources/";

const RAIL_MODES = [
  "HIGHSPEED_RAIL",
  "LONG_DISTANCE",
  "NIGHT_RAIL",
  "REGIONAL_FAST_RAIL",
  "REGIONAL_RAIL",
  "RAIL",
].join(",");
const WINDOW_S = 4 * 60 * 60;
const WINDOWS_PER_DAY = 6;
/** A stop "at" the boarding station: within this radius of its coordinates. */
const STATION_RADIUS_M = 300;

const place = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  scheduledArrival: z.string().nullish(),
  scheduledDeparture: z.string().nullish(),
});
type Place = z.infer<typeof place>;

const stopTimesResponse = z.object({
  stopTimes: z.array(
    z.object({
      place,
      tripId: z.string(),
      tripShortName: z.string().nullish(),
      routeShortName: z.string().nullish(),
      displayName: z.string().nullish(),
    })
  ),
});

const tripResponse = z.object({
  legs: z.array(
    z.object({
      from: place,
      to: place,
      intermediateStops: z.array(place).nullish(),
      agencyName: z.string().nullish(),
      tripShortName: z.string().nullish(),
      displayName: z.string().nullish(),
      legGeometry: z.object({ points: z.string(), precision: z.number().int() }).nullish(),
    })
  ),
});
type TripResponse = z.infer<typeof tripResponse>;

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

function stopOf(p: Place): ProviderStop {
  return {
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    plannedArrival: toDate(p.scheduledArrival),
    plannedDeparture: toDate(p.scheduledDeparture),
  };
}

async function fetchTrip(tripId: string): Promise<TripResponse | "unavailable"> {
  const url = `${TRANSITOUS_BASE_URL}/api/v6/trip?tripId=${encodeURIComponent(tripId)}`;
  const res = await fetchRailJson("transitous", url, tripResponse);
  return res.ok && res.data.legs.length > 0 ? res.data : "unavailable";
}

/** The departure of the asked-for train at the boarding station, if the day has one. */
async function findDeparture(
  query: RailLookupQuery
): Promise<{ tripId: string } | "noMatch" | "unavailable"> {
  const dayStart = fromZonedTime(`${query.date}T00:00:00`, query.timezone ?? "UTC");
  for (let w = 0; w < WINDOWS_PER_DAY; w++) {
    const time = new Date(dayStart.getTime() + w * WINDOW_S * 1000).toISOString();
    const url =
      `${TRANSITOUS_BASE_URL}/api/v6/stoptimes?center=${query.from.lat},${query.from.lon}` +
      `&radius=${STATION_RADIUS_M}&time=${encodeURIComponent(time)}&window=${WINDOW_S}&n=1` +
      `&mode=${RAIL_MODES}&realtimeMode=OFF&withAlerts=false`;
    const res = await fetchRailJson("transitous", url, stopTimesResponse);
    if (!res.ok) return "unavailable";
    const hit = res.data.stopTimes.find((st) => {
      const departs = toDate(st.place.scheduledDeparture);
      return (
        departs !== null &&
        isOnDay(departs, query.date, query.timezone) &&
        labelMatches(
          [st.tripShortName, st.displayName, st.routeShortName],
          query.number,
          query.category
        )
      );
    });
    if (hit) return { tripId: hit.tripId };
  }
  return "noMatch";
}

export async function lookupTransitous(query: RailLookupQuery): Promise<ProviderResult> {
  const departure = await findDeparture(query);
  if (departure === "noMatch" || departure === "unavailable") return { outcome: departure };
  const trip = await fetchTrip(departure.tripId);
  if (trip === "unavailable") return { outcome: "unavailable" };

  const stops: ProviderStop[] = [];
  for (const leg of trip.legs) {
    const legStops = [leg.from, ...(leg.intermediateStops ?? []), leg.to].map(stopOf);
    // A joined leg's first stop repeats the previous leg's last one.
    stops.push(...(stops.length > 0 ? legStops.slice(1) : legStops));
  }
  const first = trip.legs[0];
  const label = first.displayName ?? first.tripShortName ?? null;
  return {
    outcome: "matched",
    trip: {
      provider: "transitous",
      ref: departure.tripId,
      operator: first.agencyName ?? null,
      category: label ? (/^([A-Za-z]+)\s/.exec(label)?.[1]?.toUpperCase() ?? null) : null,
      number: label ? (/(\d+)/.exec(label)?.[1] ?? null) : null,
      stops,
      boardingIndex: nearestStop(stops, query.from).index,
      hasGeometry: trip.legs.some((leg) => Boolean(leg.legGeometry?.points)),
    },
  };
}

/**
 * The whole trip's traced line, `[lon, lat]`, or null when Transitous does not
 * answer or has no shape. Cached by URL with the lookup, so saving a journey
 * right after looking it up costs no second request.
 */
export async function fetchTransitousLine(tripId: string): Promise<LonLat[] | null> {
  const trip = await fetchTrip(tripId);
  if (trip === "unavailable") return null;
  const line: LonLat[] = [];
  for (const leg of trip.legs) {
    if (!leg.legGeometry?.points) return null;
    try {
      line.push(...decodePolyline(leg.legGeometry.points, leg.legGeometry.precision));
    } catch (error) {
      logger.warn({
        operation: "rail_transitous_polyline",
        tripId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
  return line.length >= 2 ? line : null;
}
