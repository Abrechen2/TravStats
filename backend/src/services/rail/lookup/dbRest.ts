import { fromZonedTime } from "date-fns-tz";
import { z } from "zod";

import { fetchRailJson } from "./railHttp";
import { isOnDay, labelMatches, nearestStop } from "./trainNumber";
import type { ProviderResult, ProviderStop, RailLookupQuery } from "./types";

/**
 * db-rest (https://v6.db.transport.rest) — the second provider: Germany, no
 * key, unofficial, built on db-vendo-client since DB shut its HAFAS down;
 * about 100 requests a minute for everybody together. It traces no line, so a
 * db-rest match is stored with a straight line.
 *
 * It addresses stops by DB's EVA number, which the station catalogue carries
 * as `dbId`; without one, the nearest stop to the coordinates stands in.
 */
export const DB_REST_BASE_URL = "https://v6.db.transport.rest";

const PRODUCTS =
  "nationalExpress=true&national=true&regionalExpress=true&regional=true" +
  "&suburban=false&bus=false&ferry=false&subway=false&tram=false&taxi=false";
const NEARBY_DISTANCE_M = 500;

const location = z.object({ latitude: z.number(), longitude: z.number() });
const line = z.object({
  name: z.string().nullish(),
  fahrtNr: z.string().nullish(),
  productName: z.string().nullish(),
  operator: z.object({ name: z.string().nullish() }).nullish(),
});

const nearbyResponse = z.array(z.object({ id: z.string(), location: location.nullish() }));
const departure = z.object({ tripId: z.string(), plannedWhen: z.string().nullish(), line });
const departuresResponse = z.union([
  z.object({ departures: z.array(departure) }),
  z.array(departure).transform((departures) => ({ departures })),
]);
const tripResponse = z.object({
  trip: z.object({
    line,
    stopovers: z.array(
      z.object({
        stop: z.object({ name: z.string(), location: location.nullish() }),
        plannedArrival: z.string().nullish(),
        plannedDeparture: z.string().nullish(),
      })
    ),
  }),
});

const toDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function stopId(query: RailLookupQuery): Promise<string | "noMatch" | "unavailable"> {
  if (query.from.dbId) return query.from.dbId;
  const url =
    `${DB_REST_BASE_URL}/locations/nearby?latitude=${query.from.lat}&longitude=${query.from.lon}` +
    `&results=1&distance=${NEARBY_DISTANCE_M}&poi=false&addresses=false`;
  const res = await fetchRailJson("db-rest", url, nearbyResponse);
  if (!res.ok) return "unavailable";
  return res.data[0]?.id ?? "noMatch";
}

export async function lookupDbRest(query: RailLookupQuery): Promise<ProviderResult> {
  const id = await stopId(query);
  if (id === "noMatch" || id === "unavailable") return { outcome: id };

  const dayStart = fromZonedTime(`${query.date}T00:00:00`, query.timezone ?? "UTC");
  const url =
    `${DB_REST_BASE_URL}/stops/${encodeURIComponent(id)}/departures` +
    `?when=${encodeURIComponent(dayStart.toISOString())}&duration=1440&results=1000` +
    `&${PRODUCTS}&remarks=false`;
  const res = await fetchRailJson("db-rest", url, departuresResponse);
  if (!res.ok) return { outcome: "unavailable" };

  const hit = res.data.departures.find((d) => {
    const when = toDate(d.plannedWhen);
    return (
      when !== null &&
      isOnDay(when, query.date, query.timezone) &&
      labelMatches([d.line.name, d.line.fahrtNr], query.number, query.category)
    );
  });
  if (!hit) return { outcome: "noMatch" };

  const tripUrl =
    `${DB_REST_BASE_URL}/trips/${encodeURIComponent(hit.tripId)}` +
    `?stopovers=true&remarks=false&polyline=false`;
  const trip = await fetchRailJson("db-rest", tripUrl, tripResponse);
  if (!trip.ok) return { outcome: "unavailable" };

  const stops: ProviderStop[] = trip.data.trip.stopovers.flatMap((s) =>
    s.stop.location
      ? [
          {
            name: s.stop.name,
            lat: s.stop.location.latitude,
            lon: s.stop.location.longitude,
            plannedArrival: toDate(s.plannedArrival),
            plannedDeparture: toDate(s.plannedDeparture),
          },
        ]
      : []
  );
  if (stops.length < 2) return { outcome: "noMatch" };
  const tripLine = trip.data.trip.line;
  return {
    outcome: "matched",
    trip: {
      provider: "db-rest",
      ref: hit.tripId,
      operator: tripLine.operator?.name ?? null,
      category: tripLine.productName?.toUpperCase() ?? null,
      number: tripLine.fahrtNr ?? null,
      stops,
      boardingIndex: nearestStop(stops, query.from).index,
      hasGeometry: false,
    },
  };
}
