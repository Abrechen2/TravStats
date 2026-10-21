import type { Trip } from "../types";
import { assessStayPlausibility, type Point } from "../shared/stayPlausibility";

const located = (p: Point): boolean =>
  typeof p.lat === "number" &&
  typeof p.lon === "number" &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon);

/**
 * Every place the trip is known to reach — both ends of each flight, train,
 * bus and ferry ride, both branches of each rental, each cruise port — or
 * null when one of its legs names a place without coordinates. A hotel near
 * such a leg's end cannot be ruled out, so the hint abstains rather than
 * guesses (beta.22 UAT: an Oslo hotel reached by ferry was flagged because
 * only flight arrivals were compared).
 */
export function tripDestinationPoints(trip: Trip): Point[] | null {
  const points: Point[] = [];
  for (const f of trip.flights ?? []) {
    points.push({ lat: f.depLat, lon: f.depLon }, { lat: f.arrLat, lon: f.arrLon });
  }
  for (const r of [
    ...(trip.railJourneys ?? []),
    ...(trip.busJourneys ?? []),
    ...(trip.ferryJourneys ?? []),
  ]) {
    if (r.status === "cancelled") continue;
    points.push({ lat: r.depLat, lon: r.depLon }, { lat: r.arrLat, lon: r.arrLon });
  }
  for (const r of trip.rentalBookings ?? []) {
    points.push({ lat: r.pickupLat, lon: r.pickupLon }, { lat: r.returnLat, lon: r.returnLon });
  }
  for (const c of trip.cruises ?? []) {
    for (const port of [c.departurePort, c.arrivalPort]) {
      if (port) points.push({ lat: port.lat, lon: port.lon });
    }
    for (const stop of c.stops ?? []) {
      if (stop.isAtSea) continue;
      points.push({ lat: stop.port?.lat, lon: stop.port?.lon });
    }
  }
  return points.every(located) ? points : null;
}

/**
 * The stays whose hotel lies far from every place the trip reaches — most
 * likely an import or typing error. None when the evidence is insufficient
 * (`tripDestinationPoints` is null) or the trip reaches nowhere located.
 */
export function implausibleStayIds(trip: Trip): Set<string> {
  const flagged = new Set<string>();
  const legs = tripDestinationPoints(trip);
  if (legs === null) return flagged;
  for (const s of trip.lodgingStays ?? []) {
    const { plausible } = assessStayPlausibility({ lat: s.lodging.lat, lon: s.lodging.lon }, legs);
    if (!plausible) flagged.add(s.id);
  }
  return flagged;
}
